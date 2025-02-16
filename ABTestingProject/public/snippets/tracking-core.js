/* Core utilities for tracking
   Manages user/session IDs in localStorage, plus retry logic for fetch */

   (function(){
    if (window.TrackingCore) {
      console.log('TrackingCore already defined, skipping initialization');
      return;
    }
  
    console.log('TrackingCore initialization started');
  
    class TrackingCore {
      constructor(config = {}) {
        this.idConfig = {
          userIdKey: 'pg_user_id',
          sessionIdKey: 'pg_session_id',
          sessionTimeout: 30 * 60 * 1000,
          lastActivityKey: 'hw-tracking-last-activity',
          storage: { local: true, cookie: true }
        };
  
        this.retryConfig = {
          maxRetries: config.maxRetries || 3,
          baseDelay: config.baseDelay || 1000,
          maxDelay: config.maxDelay || 30000,
          timeout: config.timeout || 10000
        };
  
        this.storagePrefix = 'hw-tracking-';
        this.initializeIds();
        this.setupActivityTracking();
  
        console.log('TrackingCore constructed with config:', {
          storagePrefix: this.storagePrefix,
          idConfig: this.idConfig,
          retryConfig: this.retryConfig
        });
      }
  
      initializeIds(){
        console.group('Initializing IDs');
        try {
          this.userId = this.getUserId();
          console.log('User ID initialized:', this.userId);
          this.sessionId = this.getSessionId();
          console.log('Session ID initialized:', this.sessionId);
          this.syncIds();
          console.log('ID initialization complete');
        } catch(err) {
          console.error('Error during ID init:', err);
        } finally {
          console.groupEnd();
        }
      }
  
      generateUUID(){
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = (c === 'x' ? r : (r & 0x3 | 0x8));
          return v.toString(16);
        });
      }
  
      getUserId(){
        console.group('Getting User ID');
        try {
          let existing = localStorage.getItem(this.idConfig.userIdKey);
          if (existing && existing !== 'undefined') {
            console.log('Using existing user ID:', existing);
            return existing;
          }
          const newId = this.generateUUID();
          console.log('Generated new user ID:', newId);
          return newId;
        } catch(err) {
          console.error('Error managing user ID:', err);
          const emergencyId = this.generateUUID();
          console.log('Using emergency ID:', emergencyId);
          return emergencyId;
        } finally {
          console.groupEnd();
        }
      }
  
      getSessionId(){
        console.group('Getting Session ID');
        try {
          const now = Date.now();
          const lastActivity = parseInt(localStorage.getItem(this.idConfig.lastActivityKey)) || 0;
          let sessionId = localStorage.getItem(this.idConfig.sessionIdKey);
          const expired = (now - lastActivity) > this.idConfig.sessionTimeout;
  
          if (!sessionId || expired) {
            const newSession = this.generateUUID();
            console.log('Creating new session:', {
              sessionId: newSession,
              reason: !sessionId ? 'No session' : 'Session expired'
            });
            localStorage.setItem(this.idConfig.sessionIdKey, newSession);
            localStorage.setItem(this.idConfig.lastActivityKey, now.toString());
            return newSession;
          }
          console.log('Using existing session:', sessionId);
          return sessionId;
        } catch(err) {
          console.error('Error managing session ID:', err);
          return this.generateUUID();
        } finally {
          console.groupEnd();
        }
      }
  
      syncIds(){
        console.group('Syncing IDs');
        try {
          this.syncUserId(this.userId);
          this.syncSessionId(this.sessionId);
          console.log('ID sync complete');
        } catch(err) {
          console.error('Error during ID sync:', err);
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
            this.setCookie('pg_user_id', userId, 365);
          }
        } catch(err) {
          console.error('Error syncing user ID:', err);
        }
      }
  
      syncSessionId(sessionId){
        try {
          if (this.idConfig.storage.local) {
            localStorage.setItem(this.idConfig.sessionIdKey, sessionId);
          }
          if (this.idConfig.storage.cookie) {
            this.setCookie('pg_session_id', sessionId, 1);
          }
        } catch(err) {
          console.error('Error syncing session ID:', err);
        }
      }
  
      setupActivityTracking(){
        console.group('Setting up activity tracking');
        const updateInterval = setInterval(() => {
          if (document.visibilityState === 'visible') {
            localStorage.setItem(this.idConfig.lastActivityKey, Date.now().toString());
          }
        }, 60000);
  
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            const now = Date.now();
            const lastActivity = parseInt(localStorage.getItem(this.idConfig.lastActivityKey) || '0');
            if ((now - lastActivity) > this.idConfig.sessionTimeout) {
              console.log('Session expired, new session');
              const newSession = this.generateUUID();
              localStorage.setItem(this.idConfig.sessionIdKey, newSession);
              this.syncSessionId(newSession);
            }
            localStorage.setItem(this.idConfig.lastActivityKey, now.toString());
          }
        });
  
        console.log('Activity tracking initialized');
        console.groupEnd();
      }
  
      setCookie(name, value, days){
        try {
          const maxAge = days * 24 * 60 * 60;
          const secure = (window.location.protocol === 'https:' ? '; Secure' : '');
          const domain = window.location.hostname.split('.').slice(-2).join('.');
          document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax; domain=.${domain}${secure}`;
        } catch(err) {
          console.error('Error setting cookie:', err);
        }
      }
  
      getCookie(name){
        try {
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) {
            return parts.pop().split(';').shift();
          }
          return null;
        } catch(err) {
          console.error('Error getting cookie:', err);
          return null;
        }
      }
  
      async withRetry(operation, options = {}){
        const config = { ...this.retryConfig, ...options };
        let lastError;
        for (let attempt = 0; attempt < config.maxRetries; attempt++) {
          try {
            const timeoutPromise = new Promise((_, rej) => {
              setTimeout(() => rej(new Error('Operation timed out')), config.timeout);
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
    console.log('TrackingCore exported to window');
  })();