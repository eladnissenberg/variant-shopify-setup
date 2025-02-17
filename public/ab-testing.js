// AB Testing System
(function() {
  if (window.ABTestManager) {
      console.warn('AB Testing already loaded');
      return;
  }

  // Initialize when all dependencies are ready
  const waitForDeps = () => {
      return new Promise((resolve, reject) => {
          let attempts = 0;
          const max = 50;
          const check = () => {
              attempts++;
              if (window.TrackingCore && 
                  window.AssignmentManager && 
                  window.PostgresReporter) {
                  console.log('Dependencies OK after', attempts, 'attempts');
                  resolve();
                  return;
              }
              if (attempts >= max) {
                  reject(new Error('Dependencies not found after max attempts'));
                  return;
              }
              setTimeout(check, 100);
          };
          check();
      });
  };

  class ABTestManager {
      constructor() {
          console.group('Initializing AB Testing System');
          if (ABTestManager.instance) {
              console.log('Returning existing instance');
              console.groupEnd();
              return ABTestManager.instance;
          }
          try {
              this.setupCore();
              this.setupState();
              ABTestManager.instance = this;
              console.log('AB Testing System initialized successfully');
          } catch(err) {
              console.error('Failed to init AB Testing:', err);
              throw err;
          } finally {
              console.groupEnd();
          }
      }

      // ... rest of your ABTestManager implementation ...
  }

  window.ABTestManager = ABTestManager;

  // Initialize the system
  waitForDeps().then(() => {
      console.log('All dependencies loaded, initializing ABTestManager');
      try {
          const manager = new ABTestManager();
          console.log('AB Testing Manager initialized successfully');
      } catch (err) {
          console.error('Failed to initialize AB Testing Manager:', err);
      }
  }).catch(err => {
      console.error('Failed to initialize:', err);
  });
})();