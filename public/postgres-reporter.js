/* PostgreSQL Reporter
   Queues events in localStorage, deduplicates impressions, etc.
   Dependencies: TrackingCore, AssignmentManager */

(() => {
  if (window.PostgresReporter) {
    console.warn('PostgreSQL Reporter already loaded');
    return;
  }

  class RateLimiter {
    constructor(maxRequests = 50, timeWindow = 60000) {
      this.maxRequests = maxRequests;
      this.timeWindow = timeWindow;
      this.requests = [];
    }

    async checkLimit() {
      const now = Date.now();
      this.requests = this.requests.filter(t => now - t < this.timeWindow);
      if (this.requests.length >= this.maxRequests) {
        const oldest = this.requests[0];
        const wait = this.timeWindow - (now - oldest);
        await new Promise(r => setTimeout(r, wait));
      }
      this.requests.push(now);
      return true;
    }
  }

  class EventDeduplicator {
    constructor(expiryTime = 30 * 60 * 1000) {
      this.processedEvents = new Map();
      this.EXPIRY_TIME = expiryTime;
    }

    generateKey(evt) {
      const { session_id, test_id, event_name, client_timestamp } = evt.data;
      return `${session_id}:${test_id}:${event_name}:${client_timestamp}`;
    }

    isDuplicate(evt) {
      const k = this.generateKey(evt);
      const last = this.processedEvents.get(k);
      if (!last) return false;
      const now = Date.now();
      if (now - last > this.EXPIRY_TIME) {
        this.processedEvents.delete(k);
        return false;
      }
      return true;
    }

    markProcessed(evt) {
      const k = this.generateKey(evt);
      this.processedEvents.set(k, Date.now());
    }

    cleanup() {
      const now = Date.now();
      for (const [k, t] of this.processedEvents.entries()) {
        if (now - t > this.EXPIRY_TIME) {
          this.processedEvents.delete(k);
        }
      }
    }
  }

  class QueueManager {
    constructor() {
      this.STORAGE_KEY = 'pg_event_queue';
      this.queue = [];
      this.loadPersistedQueue();
    }

    loadPersistedQueue() {
      try {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
          const arr = JSON.parse(stored);
          if (Array.isArray(arr)) {
            this.queue.push(...arr);
          }
          localStorage.removeItem(this.STORAGE_KEY);
        }
      } catch (err) {
        console.error('Failed to load queue:', err);
      }
    }

    persistQueue() {
      if (this.queue.length > 0) {
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
        } catch (err) {
          console.error('Failed to persist queue:', err);
        }
      }
    }

    add(evt) {
      this.queue.push(evt);
    }

    getBatch(size = 10) {
      return this.queue.slice(0, size);
    }

    removeBatch(size) {
      this.queue.splice(0, size);
    }

    get length() {
      return this.queue.length;
    }
  }

  class PostgresReporter {
    constructor(config = {}) {
      if (PostgresReporter.instance) {
        return PostgresReporter.instance;
      }
      try {
        this.validateDependencies();
        this.validateConfig(config);
        this.initializeCore(config);
        this.setupState();
        this.setupEventProcessing();
        this.setupCleanupTasks();
        PostgresReporter.instance = this;
      } catch (err) {
        console.error('Failed to init PostgreSQL Reporter:', err);
        throw err;
      }
    }

    validateDependencies() {
      if (typeof TrackingCore === 'undefined')
        throw new Error('TrackingCore not found');
      if (typeof AssignmentManager === 'undefined')
        throw new Error('AssignmentManager not found');
    }

    validateConfig(config) {
      const req = ['apiEndpoint', 'apiKey'];
      const missing = req.filter(k => !config[k]);
      if (missing.length > 0) {
        throw new Error(`Missing config: ${missing.join(', ')}`);
      }
    }

    initializeCore(config) {
      // Ensure endpoint ends with /events
      let endpoint = config.apiEndpoint;
      if (!endpoint.endsWith('/events')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/events';
      }

      this.config = {
        apiEndpoint: endpoint,
        apiKey: config.apiKey,
        retryAttempts: config.retryAttempts || 3,
        retryDelay: config.retryDelay || 1000,
        batchSize: config.batchSize || 10,
        maxConsecutiveFailures: config.maxConsecutiveFailures || 3
      };

      this.shopDomain = window.Shopify?.shop || window.location.hostname;
      this.core = new TrackingCore();
      this.assignmentManager = new AssignmentManager();
    }

    setupState() {
      this.rateLimiter = new RateLimiter();
      this.deduplicator = new EventDeduplicator();
      this.queueManager = new QueueManager();
      this.isProcessing = false;
      this.failedAttempts = 0;
    }

    setupEventProcessing() {
      let processingInterval;
      const processQueue = async () => {
        if (this.isProcessing || this.queueManager.length === 0) return;
        if (this.failedAttempts >= this.config.maxConsecutiveFailures) {
          clearInterval(processingInterval);
          setTimeout(() => {
            this.failedAttempts = 0;
            this.setupEventProcessing();
          }, 60000);
          return;
        }
        this.isProcessing = true;
        try {
          const batch = this.queueManager.getBatch(this.config.batchSize);
          await this.sendEvents(batch);
          this.queueManager.removeBatch(batch.length);
          this.failedAttempts = 0;
        } catch (err) {
          this.failedAttempts++;
          console.error('Failed to process event batch:', err);
        } finally {
          this.isProcessing = false;
        }
      };

      processingInterval = setInterval(processQueue, 100);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.queueManager.persistQueue();
          clearInterval(processingInterval);
        } else {
          this.setupEventProcessing();
        }
      });
    }

    setupCleanupTasks() {
      setInterval(() => {
        this.deduplicator.cleanup();
        this.assignmentManager.cleanup();
      }, 60 * 60 * 1000);
    }

    async trackAssignment({
      testId,
      assignmentType,
      assignmentMode,
      pageGroup,
      userId,
      assigned_variant,
      tested_variant
    }) {
      try {
        if (!testId || !assignmentType || !assignmentMode || !pageGroup) {
          throw new Error('Missing assignment data');
        }

        const { userId: trackedUserId } = this.core.getTrackingIds();
        const finalUserId = userId || trackedUserId;

        const existing = this.assignmentManager.getAssignment(testId);
        if (existing?.isValid()) {
          return;
        }

        const asgData = {
          type: assignmentType,
          mode: assignmentMode,
          pageGroup,
          userId: finalUserId,
          tested_variant: tested_variant || null,
          assigned_variant: assigned_variant || '0'
        };

        const asg = new TestAssignment(testId, asgData);
        this.assignmentManager.setAssignment(testId, asg);

        const event = this.createEventPayload('test_assignment', 'system', {
          test_id: testId,
          assignment_type: assignmentType,
          assignment_mode: assignmentMode,
          page_group: pageGroup,
          shop_domain: this.shopDomain,
          assigned_variant: asg.assigned_variant,
          tested_variant: tested_variant || null
        });

        await this.queueEvent(event);
        await this._trackImpression(asg);
      } catch (err) {
        console.error('Failed to track assignment:', err);
        throw err;
      }
    }

    async _trackImpression(asg) {
      try {
        const evt = this.createEventPayload('test_impression', 'test', {
          test_id: asg.testId,
          assigned_variant: asg.assigned_variant,
          page_group: asg.pageGroup,
          shop_domain: this.shopDomain,
          tested_variant: asg.tested_variant || null
        });

        if (this.deduplicator.isDuplicate(evt)) {
          return;
        }

        await this.queueEvent(evt);
        this.deduplicator.markProcessed(evt);
      } catch (err) {
        console.error('Failed to track impression:', err);
        throw err;
      }
    }

    async trackImpression(asg) {
      try {
        const evt = this.createEventPayload('test_impression', 'test', {
          test_id: asg.testId,
          assigned_variant: asg.assigned_variant,
          page_group: asg.pageGroup,
          shop_domain: this.shopDomain
        });

        if (this.deduplicator.isDuplicate(evt)) {
          return;
        }

        await this.queueEvent(evt);
        this.deduplicator.markProcessed(evt);
      } catch (err) {
        console.error('Failed to track impression:', err);
        throw err;
      }
    }

    // New dedicated method to track exposure events independently.
    async trackExposureEvent(asg) {
      try {
        const evt = this.createEventPayload('test_exposure', 'test', {
          test_id: asg.testId,
          assigned_variant: asg.assigned_variant,
          page_group: asg.pageGroup,
          shop_domain: this.shopDomain,
          tested_variant: asg.tested_variant || null
        });

        // Directly queue the exposure event without deduplication check.
        await this.queueEvent(evt);
      } catch (err) {
        console.error('Failed to track exposure event for test', asg.testId, err);
        throw err;
      }
    }

    createEventPayload(eventName, eventType, eventData = {}) {
      try {
        const { userId, sessionId } = this.core.getTrackingIds();
        if (!userId || !sessionId) {
          throw new Error('Missing user or session ID');
        }

        const allAssignments = this.assignmentManager.getAllAssignments() || [];
        const test_assignments = {};
        allAssignments.forEach(a => {
          test_assignments[a.testId] = {
            assigned_variant: a.assigned_variant,
            type: a.type,
            mode: a.mode,
            group: a.pageGroup
          };
        });

        const payload = {
          type: eventType,
          data: {
            session_id: sessionId,
            user_id: userId,
            event_name: eventName,
            event_type: eventType,
            client_timestamp: new Date().toISOString(),
            timezone_offset: new Date().getTimezoneOffset(),
            event_data: {
              ...eventData,
              test_assignments,
              path: this.cleanPath(window.location.pathname),
              template: window.Shopify?.template
                        || document.body?.getAttribute('data-template')
                        || window.location.pathname.split('/')[1]
                        || 'unknown'
            }
          }
        };

        return payload;
      } catch (err) {
        console.error('Failed createEventPayload:', err);
        throw err;
      }
    }

    cleanPath(path) {
      if (!path) return '/';
      return path.replace(/\/$/, '') || '/';
    }

    async queueEvent(evt) {
      try {
        if (!evt?.type || !evt?.data) {
          throw new Error('Invalid event structure');
        }
        if (!evt.data.user_id || !evt.data.session_id) {
          throw new Error('Missing user/session ID');
        }
        await this.rateLimiter.checkLimit();
        this.queueManager.add(evt);
      } catch (err) {
        console.error('Failed to queue event:', err);
        throw err;
      }
    }

    async sendEvents(events) {
      if (!events?.length) return;
      try {
        const invalid = events.filter(e => !e?.data?.user_id || !e?.data?.session_id);
        if (invalid.length > 0) {
          throw new Error(`Found ${invalid.length} events missing user/session ID`);
        }

        const shopId = window.Shopify?.shop || window.location.hostname;
        const resp = await this.core.withRetry(async () => {
          const r = await fetch(this.config.apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': this.config.apiKey,
              'x-shop-id': shopId
            },
            mode: 'cors',
            credentials: 'omit',
            body: JSON.stringify(events)
          });

          if (!r.ok) {
            const errorText = await r.text();
            console.error('API Error Response:', errorText);
            throw new Error(`HTTP error: ${r.status}`);
          }
          return r.json();
        }, {
          maxRetries: this.config.retryAttempts,
          baseDelay: this.config.retryDelay
        });

        return resp;
      } catch (err) {
        console.error('Failed to send events:', err);
        throw err;
      }
    }

    static initialize(config) {
      try {
        if (!window.postgresReporter) {
          window.postgresReporter = new PostgresReporter(config);
          return window.postgresReporter;
        }
        return window.postgresReporter;
      } catch (err) {
        console.error('Failed to init PostgreSQL Reporter:', err);
        throw err;
      }
    }

    static getInstance() {
      if (!window.postgresReporter) {
        throw new Error('PostgreSQL Reporter not initialized');
      }
      return window.postgresReporter;
    }
  }

  window.PostgresReporter = PostgresReporter;

  try {
    const deps = ['TrackingCore', 'AssignmentManager', 'TestAssignment'];
    const missing = deps.filter(d => typeof window[d] === 'undefined');
    if (missing.length > 0) {
      throw new Error('Missing dependencies: ' + missing.join(', '));
    }

    const config = {
      apiEndpoint: window.abTestingConfig?.apiEndpoint || "https://sessions-db-api.vercel.app/api/events",
      apiKey: window.abTestingConfig?.apiKey || "your-api-key",
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      maxConsecutiveFailures: 3
    };

    PostgresReporter.initialize(config);
  } catch (err) {
    console.error('Failed to init PostgreSQL Reporter:', err);
  }
})();