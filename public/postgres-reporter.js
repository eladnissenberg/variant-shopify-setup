/* PostgreSQL Reporter 
   Queues events in localStorage, deduplicates impressions, etc.
   Dependencies: TrackingCore, AssignmentManager */

   (() => {
    if (window.PostgresReporter) {
      console.warn('PostgreSQL Reporter already loaded');
      return;
    }
  
    class RateLimiter {
      constructor(maxRequests=50, timeWindow=60000) {
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
      constructor(expiryTime=30*60*1000) {
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
        } catch(err) {
          console.error('Failed to load queue:', err);
        }
      }
  
      persistQueue() {
        if (this.queue.length > 0) {
          try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
          } catch(err) {
            console.error('Failed to persist queue:', err);
          }
        }
      }
  
      add(evt) {
        this.queue.push(evt);
      }
  
      getBatch(size=10) {
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
      constructor(config={}) {
        console.group('Initializing PostgreSQL Reporter');
        if (PostgresReporter.instance) {
          console.log('Returning existing instance');
          console.groupEnd();
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
          console.log('PostgreSQL Reporter initialized successfully');
        } catch(err) {
          console.error('Failed to init PostgreSQL Reporter:', err);
          throw err;
        } finally {
          console.groupEnd();
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
            console.warn('Too many failures, pausing...');
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
          } catch(err) {
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
        variant,
        assignmentType,
        assignmentMode,
        pageGroup,
        userId,
        name,
        assigned_variant,
        tested_variant
      }) {
        console.group(`Tracking Assignment: ${testId}`);
        console.log('Assignment data:', {
          testId,
          variant,
          assignmentType,
          assignmentMode,
          pageGroup,
          userId,
          name,
          assigned_variant,
          tested_variant
        });
  
        try {
          if (!testId || !variant || !assignmentType || !assignmentMode || !pageGroup) {
            throw new Error('Missing assignment data');
          }
  
          const { userId: trackedUserId } = this.core.getTrackingIds();
          const finalUserId = userId || trackedUserId;
  
          const existing = this.assignmentManager.getAssignment(testId);
          if (existing?.isValid()) {
            console.log('Valid assignment exists:', existing);
            console.groupEnd();
            return;
          }
  
          const asgData = {
            variant,
            type: assignmentType,
            mode: assignmentMode,
            pageGroup,
            userId: finalUserId,
            name: name || '',
            tested_variant: tested_variant || null,
            assigned_variant: assigned_variant || variant
          };
  
          const asg = new TestAssignment(testId, asgData);
          this.assignmentManager.setAssignment(testId, asg);
          console.log('New assignment stored:', asg);
  
          const event = this.createEventPayload('test_assignment', 'system', {
            test_id: testId,
            variant,
            assignment_type: assignmentType,
            assignment_mode: assignmentMode,
            page_group: pageGroup,
            shop_domain: this.shopDomain,
            experiment_name: asg.name || '',
            assigned_variant: assigned_variant || variant,
            tested_variant: tested_variant || null
          });
  
          await this.queueEvent(event);
          await this._trackImpression(asg, tested_variant, assigned_variant);
          console.log('Assignment tracked successfully');
        } catch(err) {
          console.error('Failed to track assignment:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      async _trackImpression(asg, tested_variant, assigned_variant) {
        console.group(`Tracking Impression: ${asg.testId}`);
        try {
          const evt = this.createEventPayload('test_impression', 'test', {
            test_id: asg.testId,
            variant: asg.variant,
            page_group: asg.pageGroup,
            shop_domain: this.shopDomain,
            experiment_name: asg.name || '',
            tested_variant: tested_variant || null,
            assigned_variant: assigned_variant || asg.variant
          });
  
          if (this.deduplicator.isDuplicate(evt)) {
            console.log('Duplicate impression');
            return;
          }
  
          await this.queueEvent(evt);
          this.deduplicator.markProcessed(evt);
          console.log('Impression tracked');
        } catch(err) {
          console.error('Failed to track impression:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      async trackImpression(asg) {
        console.group(`Tracking Impression: ${asg.testId}`);
        console.log('Tracking impression:', asg);
        try {
          const evt = this.createEventPayload('test_impression', 'test', {
            test_id: asg.testId,
            variant: asg.variant,
            page_group: asg.pageGroup,
            shop_domain: this.shopDomain,
            experiment_name: asg.name || ''
          });
  
          if (this.deduplicator.isDuplicate(evt)) {
            console.log('Duplicate impression');
            return;
          }
  
          await this.queueEvent(evt);
          this.deduplicator.markProcessed(evt);
          console.log('Impression tracked');
        } catch(err) {
          console.error('Failed to track impression:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      createEventPayload(eventName, eventType, eventData = {}) {
        console.group('Creating Event Payload');
        try {
          const { userId, sessionId } = this.core.getTrackingIds();
          if (!userId || !sessionId) {
            throw new Error('Missing user or session ID');
          }
  
          const allAssignments = this.assignmentManager.getAllAssignments() || [];
          const test_assignments = {};
          allAssignments.forEach(a => {
            test_assignments[a.testId] = {
              variant: a.variant,
              type: a.type,
              mode: a.mode,
              group: a.pageGroup,
              name: a.name
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
  
          console.log('Final event payload:', payload);
          return payload;
        } catch(err) {
          console.error('Failed createEventPayload:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      cleanPath(path) {
        if (!path) return '/';
        return path.replace(/\/$/, '') || '/';
      }
  
      async queueEvent(evt) {
        console.group('Queueing Event');
        try {
          if (!evt?.type || !evt?.data) {
            throw new Error('Invalid event structure');
          }
          if (!evt.data.user_id || !evt.data.session_id) {
            throw new Error('Missing user/session ID');
          }
          await this.rateLimiter.checkLimit();
          this.queueManager.add(evt);
          console.log('Event queued:', evt);
        } catch(err) {
          console.error('Failed to queue event:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      async sendEvents(events) {
        if (!events?.length) return;
        console.group(`Sending ${events.length} Events`);
        try {
          const invalid = events.filter(e => !e?.data?.user_id || !e?.data?.session_id);
          if (invalid.length > 0) {
            throw new Error(`Found ${invalid.length} events missing user/session ID`);
          }
  
          console.log('Sending to endpoint:', this.config.apiEndpoint);
  
          const shopId = window.Shopify?.shop || window.location.hostname;
            const r = await this.core.withRetry(async () => {
              const r = await fetch(this.config.apiEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': this.config.apiKey,
                  'x-shop-id': shopId  // Use 'x-shop-id' instead of 'shop_id'
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

          console.log('Events sent:', resp);
          return resp;
        } catch(err) {
          console.error('Failed to send events:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }


    static initialize(config) {
      console.group('Initializing PostgreSQL Reporter');
      try {
        if (!window.postgresReporter) {
          window.postgresReporter = new PostgresReporter(config);
          console.log('New PostgreSQL Reporter instance created');
          return window.postgresReporter;
        }
        console.log('Returning existing instance');
        return window.postgresReporter;
      } catch(err) {
        console.error('Failed to init PostgreSQL Reporter:', err);
        throw err;
      } finally {
        console.groupEnd();
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
    console.group('Initializing PostgreSQL Reporter Instance');
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
    console.log('PostgreSQL Reporter initialized:', config);
  } catch(err) {
    console.error('Failed to init PostgreSQL Reporter:', err);
  } finally {
    console.groupEnd();
  }
})();