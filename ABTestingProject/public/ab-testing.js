/* ============================================
   Tracking Core
   ============================================ */
(function(){
  if (window.TrackingCore) {
    console.log("TrackingCore already defined, skipping initialization");
    return;
  }
  console.log("TrackingCore initialization started");
  class TrackingCore {
    constructor(config = {}) {
      this.idConfig = {
        userIdKey: "pg_user_id",
        sessionIdKey: "pg_session_id",
        sessionTimeout: 30 * 60 * 1000,
        lastActivityKey: "hw-tracking-last-activity",
        storage: { local: true, cookie: true }
      };
      this.retryConfig = {
        maxRetries: config.maxRetries || 3,
        baseDelay: config.baseDelay || 1000,
        maxDelay: config.maxDelay || 30000,
        timeout: config.timeout || 10000
      };
      this.storagePrefix = "hw-tracking-";
      this.initializeIds();
      this.setupActivityTracking();
      console.log("TrackingCore constructed with config:", {
        storagePrefix: this.storagePrefix,
        idConfig: this.idConfig,
        retryConfig: this.retryConfig
      });
    }
    initializeIds(){
      console.group("Initializing IDs");
      try {
        this.userId = this.getUserId();
        console.log("User ID initialized:", this.userId);
        this.sessionId = this.getSessionId();
        console.log("Session ID initialized:", this.sessionId);
        this.syncIds();
        console.log("ID initialization complete");
      } catch(err) {
        console.error("Error during ID init:", err);
      } finally {
        console.groupEnd();
      }
    }
    generateUUID(){
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = (c === "x" ? r : (r & 0x3 | 0x8));
        return v.toString(16);
      });
    }
    getUserId(){
      console.group("Getting User ID");
      try {
        let existing = localStorage.getItem(this.idConfig.userIdKey);
        if (existing && existing !== "undefined") {
          console.log("Using existing user ID:", existing);
          return existing;
        }
        const newId = this.generateUUID();
        console.log("Generated new user ID:", newId);
        return newId;
      } catch(err) {
        console.error("Error managing user ID:", err);
        const emergencyId = this.generateUUID();
        console.log("Using emergency ID:", emergencyId);
        return emergencyId;
      } finally {
        console.groupEnd();
      }
    }
    getSessionId(){
      console.group("Getting Session ID");
      try {
        const now = Date.now();
        const lastActivity = parseInt(localStorage.getItem(this.idConfig.lastActivityKey)) || 0;
        let sessionId = localStorage.getItem(this.idConfig.sessionIdKey);
        const expired = (now - lastActivity) > this.idConfig.sessionTimeout;
        if (!sessionId || expired) {
          const newSession = this.generateUUID();
          console.log("Creating new session:", {
            sessionId: newSession,
            reason: !sessionId ? "No session" : "Session expired"
          });
          localStorage.setItem(this.idConfig.sessionIdKey, newSession);
          localStorage.setItem(this.idConfig.lastActivityKey, now.toString());
          return newSession;
        }
        console.log("Using existing session:", sessionId);
        return sessionId;
      } catch(err) {
        console.error("Error managing session ID:", err);
        return this.generateUUID();
      } finally {
        console.groupEnd();
      }
    }
    syncIds(){
      console.group("Syncing IDs");
      try {
        this.syncUserId(this.userId);
        this.syncSessionId(this.sessionId);
        console.log("ID sync complete");
      } catch(err) {
        console.error("Error during ID sync:", err);
      } finally {
        console.groupEnd();
      }
    }
    syncUserId(userId){
      try {
        if (this.idConfig.storage.local) {
          localStorage.setItem(this.idConfig.userIdKey, userId);
        }
        if (this.idConfig.storage.cookie) {
          this.setCookie("pg_user_id", userId, 365);
        }
      } catch(err) {
        console.error("Error syncing user ID:", err);
      }
    }
    syncSessionId(sessionId){
      try {
        if (this.idConfig.storage.local) {
          localStorage.setItem(this.idConfig.sessionIdKey, sessionId);
        }
        if (this.idConfig.storage.cookie) {
          this.setCookie("pg_session_id", sessionId, 1);
        }
      } catch(err) {
        console.error("Error syncing session ID:", err);
      }
    }
    setupActivityTracking(){
      console.group("Setting up activity tracking");
      const updateInterval = setInterval(() => {
        if (document.visibilityState === "visible") {
          localStorage.setItem(this.idConfig.lastActivityKey, Date.now().toString());
        }
      }, 60000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const now = Date.now();
          const lastActivity = parseInt(localStorage.getItem(this.idConfig.lastActivityKey) || "0");
          if ((now - lastActivity) > this.idConfig.sessionTimeout) {
            console.log("Session expired, new session");
            const newSession = this.generateUUID();
            localStorage.setItem(this.idConfig.sessionIdKey, newSession);
            this.syncSessionId(newSession);
          }
          localStorage.setItem(this.idConfig.lastActivityKey, now.toString());
        }
      });
      console.log("Activity tracking initialized");
      console.groupEnd();
    }
    setCookie(name, value, days){
      try {
        const maxAge = days * 24 * 60 * 60;
        const secure = (window.location.protocol === "https:" ? "; Secure" : "");
        const domain = window.location.hostname.split(".").slice(-2).join(".");
        document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax; domain=.${domain}${secure}`;
      } catch(err) {
        console.error("Error setting cookie:", err);
      }
    }
    getCookie(name){
      try {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
          return parts.pop().split(";").shift();
        }
        return null;
      } catch(err) {
        console.error("Error getting cookie:", err);
        return null;
      }
    }
    async withRetry(operation, options = {}){
      const config = { ...this.retryConfig, ...options };
      let lastError;
      for (let attempt = 0; attempt < config.maxRetries; attempt++) {
        try {
          const timeoutPromise = new Promise((_, rej) => {
            setTimeout(() => rej(new Error("Operation timed out")), config.timeout);
          });
          const result = await Promise.race([
            operation(),
            timeoutPromise
          ]);
          return result;
        } catch(err) {
          lastError = err;
          console.warn(`Attempt ${attempt + 1} failed:`, err);
          if (attempt < config.maxRetries - 1) {
            const delay = Math.min(
              config.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
              config.maxDelay
            );
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      throw lastError;
    }
    getTrackingIds(){
      return {
        userId: this.userId,
        sessionId: this.sessionId
      };
    }
  }
  window.TrackingCore = TrackingCore;
  console.log("TrackingCore exported to window");
})();


/* ============================================
   Assignment Manager
   ============================================ */
(function() {
  if (window.TestAssignment || window.AssignmentManager) {
    console.warn("Assignment Manager already loaded, skipping initialization");
    return;
  }
  class TestAssignment {
    constructor(testId, data) {
      console.group("Creating Test Assignment");
      try {
        this.testId = testId;
        this.variant = data.variant;
        this.type = data.type;
        this.mode = data.mode;
        this.pageGroup = data.pageGroup;
        this.timestamp = Date.now();
        this.name = data.name || "";
        this.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
        this.assigned_variant = data.assigned_variant || this.variant;
        console.log("Created assignment:", this.toStorageFormat());
      } catch (err) {
        console.error("Failed to create assignment:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    validateInput(testId, data) {
      if (!testId) throw new Error("TestId is required");
      if (!data) throw new Error("Assignment data required");
      const req = ["variant", "type", "mode", "pageGroup"];
      const missing = req.filter(f => !data[f]);
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(", ")}`);
      }
    }
    isValid() {
      console.group("Validating Assignment");
      try {
        const required = ["testId", "variant", "type", "mode", "pageGroup", "timestamp"];
        const hasAll = required.every(f => this[f] !== undefined);
        const notExpired = (Date.now() - this.timestamp) < (30 * 24 * 60 * 60 * 1000);
        const isValid = hasAll && notExpired;
        console.log("Validation result:", { isValid, hasAll, notExpired });
        return isValid;
      } finally {
        console.groupEnd();
      }
    }
    toStorageFormat() {
      return {
        testId: this.testId,
        variant: this.variant,
        type: this.type,
        mode: this.mode,
        pageGroup: this.pageGroup,
        timestamp: this.timestamp,
        name: this.name
      };
    }
    toPixelFormat() {
      return {
        testId: this.testId,
        variant: this.variant,
        type: this.type,
        mode: this.mode,
        group: this.pageGroup,
        name: this.name,
        tested_variant: this.tested_variant,
        assigned_variant: this.assigned_variant
      };
    }
    static fromStorage(data) {
      console.group("Creating Assignment from Storage");
      try {
        if (!data?.testId) {
          console.log("Invalid storage data");
          return null;
        }
        const asg = new TestAssignment(data.testId, data);
        asg.name = data.name ? data.name : "";
        asg.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
        asg.assigned_variant = data.assigned_variant || data.variant;
        console.log("Created assignment from storage:", asg);
        return asg;
      } catch (err) {
        console.error("Failed to create assignment from storage:", err);
        return null;
      } finally {
        console.groupEnd();
      }
    }
  }
  class AssignmentManager {
    constructor() {
      console.group("Initializing Assignment Manager");
      if (AssignmentManager.instance) {
        console.log("Returning existing instance");
        console.groupEnd();
        return AssignmentManager.instance;
      }
      try {
        this.setupCore();
        AssignmentManager.instance = this;
        console.log("Assignment Manager initialized successfully");
      } catch (err) {
        console.error("Failed to init Assignment Manager:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    setupCore() {
      if (typeof TrackingCore === "undefined") {
        throw new Error("TrackingCore not found");
      }
      this.STORAGE_KEYS = {
        assignments: "hw-abt-assignments",
        activeTests: "pg_active_tests"
      };
      this.assignments = new Map();
      this.core = new TrackingCore();
      this.loadFromStorage();
      this.persist();
    }
    loadFromStorage() {
      console.group("Loading Assignments from Storage");
      try {
        const stored = localStorage.getItem(this.STORAGE_KEYS.assignments);
        console.log("Raw storage data:", stored);
        if (stored) {
          const data = JSON.parse(stored);
          Object.entries(data).forEach(([tid, asgData]) => {
            const asg = TestAssignment.fromStorage(asgData);
            if (asg?.isValid()) {
              this.assignments.set(tid, asg);
              console.log(`Loaded valid assignment for ${tid}`);
            } else {
              console.log(`Skipped invalid assignment for ${tid}`);
            }
          });
        }
        console.log("Loaded assignments:", Array.from(this.assignments.entries()));
      } catch (err) {
        console.error("Failed to load assignments:", err);
      } finally {
        console.groupEnd();
      }
    }
    setAssignment(testId, data) {
      console.group(`Setting Assignment for ${testId}`);
      try {
        const asg = new TestAssignment(testId, data);
        this.assignments.set(testId, asg);
        this.persist();
        console.log("Assignment set successfully:", asg);
        return asg;
      } catch (err) {
        console.error("Failed to set assignment:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    getAssignment(testId) {
      console.group(`Getting Assignment for ${testId}`);
      try {
        const asg = this.assignments.get(testId);
        const valid = asg?.isValid();
        console.log("Assignment retrieval:", { found: !!asg, valid, asg });
        return valid ? asg : null;
      } finally {
        console.groupEnd();
      }
    }
    getAllAssignments() {
      console.group("Getting All Assignments");
      try {
        const valid = Array.from(this.assignments.values()).filter(a => a.isValid());
        console.log("Valid assignments:", valid);
        return valid;
      } finally {
        console.groupEnd();
      }
    }
    recalculateTestedVariants() {
      console.group("Recalculating tested_variant for all assignments by page group");
      try {
        const groups = {};
        this.assignments.forEach(assignment => {
          const group = assignment.pageGroup || "default";
          if (!groups[group]) {
            groups[group] = [];
          }
          groups[group].push(assignment);
        });
        Object.keys(groups).forEach(group => {
          const groupAssignments = groups[group];
          const nonZeroAssignments = groupAssignments.filter(a => a.assigned_variant !== "0");
          const nonZeroCount = nonZeroAssignments.length;
          if (nonZeroCount === 0) {
            groupAssignments.forEach(a => {
              a.tested_variant = "0";
            });
            console.log(`Group "${group}": all assignments are control; tested_variant set to "0" for all`);
          } else if (nonZeroCount === 1) {
            groupAssignments.forEach(a => {
              if (a.assigned_variant !== "0") {
                a.tested_variant = a.assigned_variant;
              } else {
                a.tested_variant = "excluded";
              }
            });
            console.log(`Group "${group}": exactly one non-control assignment; that assignment's tested_variant set to its value, others to "excluded"`);
          } else {
            groupAssignments.forEach(a => {
              a.tested_variant = "excluded";
            });
            console.log(`Group "${group}": multiple non-control assignments; tested_variant set to "excluded" for all`);
          }
        });
      } catch (err) {
        console.error("Error recalculating tested_variant:", err);
      } finally {
        console.groupEnd();
      }
    }
    persist() {
      console.group("Persisting Assignments");
      try {
        this.recalculateTestedVariants();
        const storageData = {};
        const pixelData = {};
        this.assignments.forEach((asg, tid) => {
          if (asg.isValid()) {
            storageData[tid] = asg.toStorageFormat();
            pixelData[tid] = asg.toPixelFormat();
          }
        });
        localStorage.setItem(this.STORAGE_KEYS.assignments, JSON.stringify(storageData));
        localStorage.setItem(this.STORAGE_KEYS.activeTests, JSON.stringify(pixelData));
        console.log("Persisted data:", { storageData, pixelData });
      } catch (err) {
        console.error("Failed to persist:", err);
      } finally {
        console.groupEnd();
      }
    }
    cleanup() {
      console.group("Cleaning Up Assignments");
      try {
        let changed = false;
        this.assignments.forEach((asg, tid) => {
          if (!asg.isValid()) {
            this.assignments.delete(tid);
            changed = true;
            console.log(`Removed invalid assignment for test ${tid}`);
          }
        });
        if (changed) {
          this.persist();
          console.log("Persisted changes after cleanup");
        } else {
          console.log("No cleanup needed");
        }
      } catch (err) {
        console.error("Failed to cleanup assignments:", err);
      } finally {
        console.groupEnd();
      }
    }
  }
  window.TestAssignment = TestAssignment;
  window.AssignmentManager = AssignmentManager;
  try {
    new AssignmentManager();
  } catch (err) {
    console.error("Failed to initialize shared Assignment Manager:", err);
  }
})();


/* ============================================
   AB Testing System
   ============================================ */
(function(){
  if (window.ABTestManager) {
    console.warn("AB Testing already loaded");
    return;
  }
  const checkDependencies = () => {
    const required = ["TrackingCore","TestAssignment","AssignmentManager"];
    const missing = required.filter(d => !window[d]);
    if (missing.length > 0) {
      console.error("Missing AB Testing deps:", missing);
      return false;
    }
    console.log("All AB Testing deps loaded");
    return true;
  };
  if (!checkDependencies()) {
    console.error("Cannot init AB Testing - missing deps");
    return;
  }
  class ABTestManager {
    constructor(){
      console.group("Initializing AB Testing System");
      if (ABTestManager.instance) {
        console.log("Returning existing instance");
        console.groupEnd();
        return ABTestManager.instance;
      }
      try {
        this.setupCore();
        this.setupState();
        ABTestManager.instance = this;
        console.log("AB Testing System initialized successfully");
      } catch(err){
        console.error("Failed to init AB Testing:",err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    setupCore(){
      console.group("Setting up core");
      this.core = new TrackingCore();
      this.assignmentManager = new AssignmentManager();
      this.settings = {/* settings object as provided by Shopify theme settings */};
      console.log("Settings loaded:", this.settings);
      console.groupEnd();
    }
    setupState(){
      console.group("Setting up state");
      this.allTests = [];
      const { userId, sessionId } = this.core.getTrackingIds();
      this.userId = userId;
      this.sessionId = sessionId;
      console.log("State:", { userId, sessionId });
      console.groupEnd();
    }
    async initialize(){
      console.group("Initializing Test System");
      try {
        this.assignmentManager.cleanup();
        await this.loadActiveTestsFromSettings();
        this.assignAllGroups();
        this.applyAssignments();
        await this.trackTestAssignments();
        return true;
      } catch(err) {
        console.error("Failed to initialize:", err);
        return false;
      } finally {
        console.groupEnd();
      }
    }
    async loadActiveTestsFromSettings(){
      console.group("Loading Tests from Theme Settings");
      try {
        const experimentKeys = Object.keys(this.settings).filter(k => /^AB\d+$/.test(k));
        this.allTests = experimentKeys.map(testId => {
          const modeValue = this.settings[testId];
          let forcedVariant = null;
          let testMode = "test";
          if (modeValue === "test") {
            testMode = "test";
          } else if (modeValue.startsWith("v")) {
            forcedVariant = modeValue.replace("v","");
            testMode = "forced";
          }
          const locKey = `${testId}_location`;
          const devKey = `${testId}_device`;
          const location = this.settings[locKey] || "global";
          const device = this.settings[devKey] || "both";
          const nameKey = `${testId}_name`;
          const testName = this.settings[nameKey] || "";
          const countKey = `${testId}_variants_count`;
          const variantsCount = parseInt(this.settings[countKey] || "1", 10) || 1;
          const possibleVars = [];
          for (let i=1; i<=variantsCount; i++){
            possibleVars.push(String(i));
          }
          return {
            id: testId,
            mode: testMode,
            forcedVariant,
            location,
            device,
            testName,
            possibleNonZeroVariants: possibleVars
          };
        });
        console.log("All tests from settings:", this.allTests);
      } catch(err){
        console.error("Error loading tests:", err);
      } finally{
        console.groupEnd();
      }
    }
    assignAllGroups() {
      console.group("Assigning variants for each group");
      const groupMap = {};
      this.allTests.forEach(t => {
        const g = t.location;
        groupMap[g] = groupMap[g] || [];
        groupMap[g].push(t);
      });
      Object.keys(groupMap).forEach(group => {
        const testsInGroup = groupMap[group];
        this.assignGroup(group, testsInGroup);
      });
      console.groupEnd();
    }
    assignGroup(group, tests) {
      console.group(`Assigning group="${group}":`, tests);
      const forcedTests = tests.filter(t => t.mode === "forced");
      const unforcedTests = tests.filter(t => t.mode === "test");
      forcedTests.forEach(ft => {
        const forcedVar = ft.forcedVariant || "0";
        const assignmentData = {
          variant: forcedVar,
          assigned_variant: forcedVar,
          tested_variant: forcedVar,
          type: (forcedVar === "0") ? "control" : "test",
          mode: (forcedVar === "0") ? "forced-0" : "forced",
          pageGroup: group,
          name: ft.testName || ""
        };
        this.setOrKeepAssignment(ft, assignmentData);
      });
      if (unforcedTests.length === 0) {
        console.log(`No unforced tests for group=${group}`);
        console.groupEnd();
        return;
      }
      const trafficKey = `hw-${group}-traffic`;
      const trafficValStr = this.settings[trafficKey] || "0";
      const traffic = parseInt(trafficValStr,10) || 0;
      const fraction = traffic / 100; 
      console.log(`Group=${group}, fraction=${fraction}`);
      const rng = Math.random();
      console.log(`rng=${rng}, group=${group}`);
      if (rng >= fraction) {
        unforcedTests.forEach(t => {
          const assignmentData = {
            variant: "0",
            assigned_variant: "0",
            tested_variant: "0",
            type: "control",
            mode: "pure-control",
            pageGroup: group,
            name: t.testName || ""
          };
          this.setOrKeepAssignment(t, assignmentData);
        });
      } else {
        const chosenIndex = Math.floor(Math.random() * unforcedTests.length);
        unforcedTests.forEach((testObj, idx) => {
          if (idx === chosenIndex) {
            const arr = testObj.possibleNonZeroVariants || ["1"];
            const pick2 = Math.floor(Math.random() * arr.length);
            const finalVar = arr[pick2];
            console.log(`Test ${testObj.id} => chosen variant=${finalVar}`);
            const assignmentData = {
              variant: finalVar,
              assigned_variant: finalVar,
              tested_variant: finalVar,
              type: "test",
              mode: "probabilistic",
              pageGroup: group,
              name: testObj.testName || ""
            };
            this.setOrKeepAssignment(testObj, assignmentData);
          } else {
            const assignmentData = {
              variant: "0",
              assigned_variant: "0",
              tested_variant: "0",
              type: "control",
              mode: "excluded",
              pageGroup: group,
              name: testObj.testName || ""
            };
            this.setOrKeepAssignment(testObj, assignmentData);
          }
        });
      }
      console.groupEnd();
    }
    setOrKeepAssignment(testObj, data){
      console.group(`Setting/Updating Assignment for ${testObj.id}`);
      this.assignmentManager.setAssignment(testObj.id, data);
      console.groupEnd();
    }
    applyAssignments(){
      console.group("Applying Assignments");
      if (!document.body) {
        console.warn("No document.body");
        console.groupEnd();
        return;
      }
      const currentTemplate = "home";
      const templateToGroup = {
        product: "product",
        collection: "collection",
        cart: "cart",
        checkout: "checkout",
        index: "home"
      };
      const mappedGroup = templateToGroup[currentTemplate] || "home";
      const relevantGroups = ["global", mappedGroup];
      console.log("Relevant groups for apply:", relevantGroups);
      const assts = this.assignmentManager.getAllAssignments() || [];
      const toApply = assts.filter(a => relevantGroups.includes(a.pageGroup));
      console.log("Assignments to apply:", toApply);
      const prefix = "ab";
      toApply.forEach(a => {
        if (a.variant !== "0") {
          document.body.classList.add(
            `${prefix}-active`,
            `${prefix}-${a.testId}`,
            `${prefix}-${a.testId}-${a.variant}`
          );
          document.body.classList.add(`${prefix}-${a.pageGroup}`);
        } else {
          document.body.classList.add(`${prefix}-${a.testId}-0`);
        }
      });
      console.groupEnd();
    }
    async trackTestAssignments(){
      console.group("Tracking Test Assignments");
      try {
        if (!window.postgresReporter) {
          throw new Error("PostgreSQL reporter not found");
        }
        const assts = this.assignmentManager.getAllAssignments() || [];
        console.log("Tracking assignments:", assts);
        for (const a of assts) {
          await window.postgresReporter.trackAssignment({
            testId: a.testId,
            variant: a.variant,
            assignmentType: a.type,
            assignmentMode: a.mode,
            pageGroup: a.pageGroup,
            userId: this.userId,
            name: a.name,
            assigned_variant: a.assigned_variant,
            tested_variant: a.tested_variant
          });
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            abTest: {
              testId: a.testId,
              variant: a.variant,
              mode: a.mode
            }
          });
        }
        console.log("Test assignments tracked successfully");
      } catch(err){
        console.error("Failed to track test assignments:", err);
      } finally{
        console.groupEnd();
      }
    }
  }
  window.ABTestManager = ABTestManager;
  const waitForDeps = () => {
    return new Promise((resolve,reject)=>{
      let attempts = 0;
      const max = 50;
      const check = () => {
        attempts++;
        if(window.TrackingCore && document.body){
          console.log("Dependencies OK after", attempts, "attempts");
          resolve();
          return;
        }
        if(attempts >= max){
          reject(new Error("Deps not found after max attempts"));
          return;
        }
        if(document.readyState === "complete" && !window.TrackingCore){
          reject(new Error("No TrackingCore after page load"));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  };
  const initSystem = async () => {
    console.group("Initializing System");
    try {
      await waitForDeps();
      console.log("Deps available, creating ABTestManager");
      const mgr = new ABTestManager();
      const ok = await mgr.initialize();
      console.log("AB Testing init complete:", { success: ok });
    } catch(err) {
      console.error("Failed to init AB Testing System:", err);
    } finally{
      console.groupEnd();
    }
  };
  console.log("Starting AB Testing System initialization");
  initSystem();
})();


/* ============================================
   PostgreSQL Reporter
   ============================================ */
(function() {
  if (window.PostgresReporter) {
    console.warn("PostgreSQL Reporter already loaded");
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
      this.STORAGE_KEY = "pg_event_queue";
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
        console.error("Failed to load queue:", err);
      }
    }
    persistQueue() {
      if (this.queue.length > 0) {
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
        } catch (err) {
          console.error("Failed to persist queue:", err);
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
      console.group("Initializing PostgreSQL Reporter");
      if (PostgresReporter.instance) {
        console.log("Returning existing instance");
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
        console.log("PostgreSQL Reporter initialized successfully");
      } catch (err) {
        console.error("Failed to init PostgreSQL Reporter:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    validateDependencies() {
      if (typeof TrackingCore === "undefined")
        throw new Error("TrackingCore not found");
      if (typeof AssignmentManager === "undefined")
        throw new Error("AssignmentManager not found");
    }
    validateConfig(config) {
      const req = ["apiEndpoint", "apiKey"];
      const missing = req.filter(k => !config[k]);
      if (missing.length > 0) {
        throw new Error(`Missing config: ${missing.join(", ")}`);
      }
    }
    initializeCore(config) {
      this.config = {
        apiEndpoint: config.apiEndpoint + "/events",
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
          console.warn("Too many failures, pausing...");
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
          console.error("Failed to process event batch:", err);
        } finally {
          this.isProcessing = false;
        }
      };
      processingInterval = setInterval(processQueue, 100);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
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
      console.log("Assignment data:", {
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
          throw new Error("Missing assignment data (testId, variant, assignmentType, assignmentMode, pageGroup are required)");
        }
        const { userId: trackedUserId } = this.core.getTrackingIds();
        const finalUserId = userId || trackedUserId;
        const existing = this.assignmentManager.getAssignment(testId);
        if (existing?.isValid()) {
          console.log("Valid assignment already exists:", existing);
          console.groupEnd();
          return;
        }
        const asgData = {
          variant,
          type: assignmentType,
          mode: assignmentMode,
          pageGroup,
          userId: finalUserId,
          name: name || "",
          tested_variant: tested_variant || null,
          assigned_variant: assigned_variant || variant
        };
        const asg = new TestAssignment(testId, asgData);
        this.assignmentManager.setAssignment(testId, asg);
        console.log("New assignment stored:", asg);
        const event = this.createEventPayload("test_assignment", "system", {
          test_id: testId,
          variant,
          assignment_type: assignmentType,
          assignment_mode: assignmentMode,
          page_group: pageGroup,
          shop_domain: this.shopDomain,
          experiment_name: asg.name || "",
          assigned_variant: assigned_variant || variant,
          tested_variant: tested_variant || null
        });
        await this.queueEvent(event);
        await this._trackImpression(asg, tested_variant, assigned_variant);
        console.log("Assignment tracked successfully");
      } catch (err) {
        console.error("Failed to track assignment:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    async _trackImpression(asg, tested_variant, assigned_variant) {
      console.group(`Tracking Impression: ${asg.testId}`);
      try {
        const evt = this.createEventPayload("test_impression", "test", {
          test_id: asg.testId,
          variant: asg.variant,
          page_group: asg.pageGroup,
          shop_domain: this.shopDomain,
          experiment_name: asg.name || "",
          tested_variant: tested_variant || null,
          assigned_variant: assigned_variant || asg.variant
        });
        if (this.deduplicator.isDuplicate(evt)) {
          console.log("Duplicate impression");
          return;
        }
        await this.queueEvent(evt);
        this.deduplicator.markProcessed(evt);
        console.log("Impression tracked");
      } catch (err) {
        console.error("Failed to track impression:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    async trackImpression(asg) {
      console.group(`Tracking Impression: ${asg.testId}`);
      console.log("Tracking impression:", asg);
      try {
        const evt = this.createEventPayload("test_impression", "test", {
          test_id: asg.testId,
          variant: asg.variant,
          page_group: asg.pageGroup,
          shop_domain: this.shopDomain,
          experiment_name: asg.name || ""
        });
        if (this.deduplicator.isDuplicate(evt)) {
          console.log("Duplicate impression");
          return;
        }
        await this.queueEvent(evt);
        this.deduplicator.markProcessed(evt);
        console.log("Impression tracked");
      } catch (err) {
        console.error("Failed to track impression:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    createEventPayload(eventName, eventType, eventData = {}) {
      console.group("Creating Event Payload");
      try {
        const { userId, sessionId } = this.core.getTrackingIds();
        if (!userId || !sessionId) {
          throw new Error("Missing user or session ID");
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
              template: window.Shopify?.template || document.body?.getAttribute("data-template") || window.location.pathname.split("/")[1] || "unknown"
            }
          }
        };
        console.log("Final event payload:", payload);
        return payload;
      } catch (err) {
        console.error("Failed createEventPayload:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    cleanPath(path) {
      if (!path) return "/";
      return path.replace(/\/$/, "") || "/";
    }
    async queueEvent(evt) {
      console.group("Queueing Event");
      try {
        if (!evt?.type || !evt?.data) {
          throw new Error("Invalid event structure");
        }
        if (!evt.data.user_id || !evt.data.session_id) {
          throw new Error("Missing user/session ID");
        }
        await this.rateLimiter.checkLimit();
        this.queueManager.add(evt);
        console.log("Event queued:", evt);
      } catch (err) {
        console.error("Failed to queue event:", err);
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
        const resp = await this.core.withRetry(async () => {
          const r = await fetch(this.config.apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": this.config.apiKey
            },
            body: JSON.stringify(events)
          });
          if (!r.ok) {
            throw new Error(`HTTP error: ${r.status}`);
          }
          return r.json();
        }, {
          maxRetries: this.config.retryAttempts,
          baseDelay: this.config.retryDelay
        });
        console.log("Events sent:", resp);
        return resp;
      } catch (err) {
        console.error("Failed to send events:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    static initialize(config) {
      console.group("Initializing PostgreSQL Reporter");
      try {
        if (!window.postgresReporter) {
          window.postgresReporter = new PostgresReporter(config);
          console.log("New PostgreSQL Reporter instance created");
          return window.postgresReporter;
        }
        console.log("Returning existing instance");
        return window.postgresReporter;
      } catch (err) {
        console.error("Failed to init PostgreSQL Reporter:", err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }
    static getInstance() {
      if (!window.postgresReporter) {
        throw new Error("PostgreSQL Reporter not initialized");
      }
      return window.postgresReporter;
    }
  }
  window.PostgresReporter = PostgresReporter;
  try {
    console.group("Initializing PostgreSQL Reporter Instance");
    const deps = ["TrackingCore", "AssignmentManager", "TestAssignment"];
    const missing = deps.filter(d => typeof window[d] === "undefined");
    if (missing.length > 0) {
      throw new Error("Missing dependencies: " + missing.join(", "));
    }
    const config = {
      apiEndpoint: "https://api.yourdomain.com", // replace with actual endpoint
      apiKey: "your_api_key", // replace with actual API key
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 10,
      maxConsecutiveFailures: 3
    };
    PostgresReporter.initialize(config);
    console.log("PostgreSQL Reporter initialized:", config);
  } catch (err) {
    console.error("Failed to init PostgreSQL Reporter:", err);
  } finally {
    console.groupEnd();
  }
})();
