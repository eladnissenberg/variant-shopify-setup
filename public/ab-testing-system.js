// AB Testing System
(() => {
  if (window.ABTestManager) {
    console.warn('AB Testing already loaded');
    return;
  }

  // Check dependencies
  const checkDependencies = () => {
    const required = ['TrackingCore', 'TestAssignment', 'AssignmentManager'];
    const missing = required.filter(d => !window[d]);
    if (missing.length > 0) {
      console.error('Missing AB Testing deps:', missing);
      return false;
    }
    return true;
  };

  if (!checkDependencies()) {
    console.error('Cannot init AB Testing - missing deps');
    return;
  }

  class ABTestManager {
    constructor() {
      if (ABTestManager.instance) {
        return ABTestManager.instance;
      }
      try {
        this.setupCore();
        this.setupState();
        ABTestManager.instance = this;
      } catch (err) {
        console.error('Failed to init AB Testing:', err);
        throw err;
      }
    }

    setupCore() {
      this.core = new TrackingCore();
      this.assignmentManager = new AssignmentManager();
      // Use window.abTestingConfig (populated by our Liquid snippet)
      this.settings = window.abTestingConfig || {};
    }

    setupState() {
      this.allTests = [];
      const { userId, sessionId } = this.core.getTrackingIds();
      this.userId = userId;
      this.sessionId = sessionId;
    }

    async initialize() {
      try {
        // Clean up old assignments
        this.assignmentManager.cleanup();
    
        // 1) Gather tests from settings
        await this.loadActiveTestsFromSettings();
    
        // 2) Assign variants
        this.assignAllGroups();
    
        // 3) Apply classes to <body>
        this.applyAssignments();
    
        // Persist the updated assignments
        this.assignmentManager.persist();
    
        // 4) Track exposure events for assignments using dedicated exposure tracking
        // Remove test_exposure events: comment out or remove the following line.
        // await this.trackExposureEvents();
    
        return true;
      } catch (err) {
        console.error('Failed to initialize:', err);
        return false;
      }
    }

    loadActiveTestsFromSettings() {
      try {
        // Get tests from window.abTestingConfig.tests (populated by Liquid)
        const tests = this.settings.tests || [];

        // Map each test into a standardized object.
        // For page-specific tests, if a URL is provided, we use that as the location.
        this.allTests = tests.map(test => {
          // Force modeValue to be a string so we can use startsWith()
          const modeValue = String(test.mode || 'test');
          let forcedVariant = null;
          let testMode = 'test';

          if (modeValue === 'test') {
            testMode = 'test';
          } else if (modeValue.startsWith('v')) {
            forcedVariant = modeValue.replace('v', '');
            testMode = 'forced';
          }

          // Save the original location (could be "global", "homepage", etc. or "page_specific")
          let originalLocation = test.location || 'global';
          let location = originalLocation;

          // For page-specific tests, if a URL is provided, override location with that URL.
          if (originalLocation === 'page_specific' && test.page_specific_url) {
            location = test.page_specific_url;
          }

          return {
            id: test.id,
            mode: testMode,
            forcedVariant,
            location,
            originalLocation,
            device: test.device || 'both',
            possibleNonZeroVariants: [...Array(test.variantsCount || 1)].map((_, i) => String(i + 1))
          };
        });
      } catch (err) {
        console.error('Error loading tests:', err);
      }
    }

    assignAllGroups() {
      const groupMap = {};
      this.allTests.forEach(t => {
        // Group tests by their resolved location.
        const g = t.location;
        groupMap[g] = groupMap[g] || [];
        groupMap[g].push(t);
      });

      Object.keys(groupMap).forEach(group => {
        const testsInGroup = groupMap[group];
        this.assignGroup(group, testsInGroup);
      });
    }

    assignGroup(group, tests) {
      const forcedTests = tests.filter(t => t.mode === 'forced');
      const unforcedTests = tests.filter(t => t.mode === 'test');

      // 1) Handle forced tests
      forcedTests.forEach(ft => {
        const forcedVar = ft.forcedVariant || '0';
        const assignmentData = {
          assigned_variant: forcedVar,
          tested_variant: forcedVar,
          type: (forcedVar === '0') ? 'control' : 'test',
          mode: (forcedVar === '0') ? 'forced-0' : 'forced',
          pageGroup: group
        };
        this.setOrKeepAssignment(ft, assignmentData);
      });

      // 2) Handle unforced tests
      if (unforcedTests.length === 0) {
        return;
      }

      // Determine traffic allocation.
      // For page-specific tests, use "page_specific" traffic.
      // Otherwise, check the group name in the traffic config.
      const trafficConfig = this.settings.traffic || {};
      let traffic;
      if (unforcedTests[0].originalLocation === 'page_specific') {
        traffic = parseInt(trafficConfig['page_specific'] || '0', 10) || 0;
      } else {
        const standardGroups = ['global', 'homepage', 'product', 'collection', 'cart', 'checkout'];
        if (standardGroups.includes(group)) {
          traffic = parseInt(trafficConfig[group] || '0', 10) || 0;
        } else {
          traffic = 0;
        }
      }

      const fraction = traffic / 100;
      const rng = Math.random();

      if (rng >= fraction) {
        // User not in experiment: assign control variant.
        unforcedTests.forEach(t => {
          const assignmentData = {
            assigned_variant: '0',
            tested_variant: '0',
            type: 'control',
            mode: 'pure-control',
            pageGroup: group
          };
          this.setOrKeepAssignment(t, assignmentData);
        });
      } else {
        // User in experiment: choose one test to run a non-control variant.
        const chosenIndex = Math.floor(Math.random() * unforcedTests.length);
        unforcedTests.forEach((testObj, idx) => {
          if (idx === chosenIndex) {
            const arr = testObj.possibleNonZeroVariants || ['1'];
            const pick2 = Math.floor(Math.random() * arr.length);
            const finalVar = arr[pick2];

            const assignmentData = {
              assigned_variant: finalVar,
              tested_variant: finalVar,
              type: 'test',
              mode: 'probabilistic',
              pageGroup: group
            };
            this.setOrKeepAssignment(testObj, assignmentData);
          } else {
            const assignmentData = {
              assigned_variant: '0',
              tested_variant: '0',
              type: 'control',
              mode: 'excluded',
              pageGroup: group
            };
            this.setOrKeepAssignment(testObj, assignmentData);
          }
        });
      }
    }

    // Check for an existing valid assignment before setting a new one.
    setOrKeepAssignment(testObj, data) {
      const existingAssignment = this.assignmentManager.getAssignment(testObj.id);
      if (existingAssignment) {
        // Keep existing assignment
      } else {
        this.assignmentManager.setAssignment(testObj.id, data);
      }
    }

    // Apply assignments by adding corresponding body classes.
    applyAssignments() {
      if (!document.body) {
        console.warn('No document.body');
        return;
      }

      let currentTemplate = document.body.getAttribute('data-template');

      const getPath = (str) => {
        try {
          let url = new URL(str);
          return url.pathname.replace(/\/+$/, '');
        } catch (e) {
          if (!str.startsWith('/')) {
            str = '/' + str;
          }
          return str.replace(/\/+$/, '');
        }
      };

      const currentPath = getPath(window.location.href);

      if (!currentTemplate) {
        if (currentPath === '/' || currentPath === '') {
          currentTemplate = 'homepage';
        } else if (currentPath.indexOf('/products/') === 0) {
          currentTemplate = 'product';
        } else if (currentPath.indexOf('/collections/') === 0) {
          if (currentPath.indexOf('/products/') !== -1) {
            currentTemplate = 'product';
          } else {
            currentTemplate = 'collection';
          }
        } else if (currentPath.indexOf('/cart') === 0) {
          currentTemplate = 'cart';
        } else if (currentPath.indexOf('/checkout') === 0) {
          currentTemplate = 'checkout';
        } else {
          currentTemplate = currentPath.split('/')[1] || 'home';
        }
      }

      const standardGroups = ['global', currentTemplate];

      // Get all valid assignments.
      const assts = this.assignmentManager.getAllAssignments() || [];
      
      // Get currently active test IDs
      const activeTestIds = this.allTests.map(test => test.id);
      
      // Filter assignments to only those for active tests that match the current page
      const toApply = assts.filter(a => {
        // First check if the test is still active
        if (!activeTestIds.includes(a.testId)) {
          return false;
        }
        // Then check if it's relevant to the current page
        if (standardGroups.includes(a.pageGroup)) {
          return true;
        }
        return getPath(a.pageGroup) === currentPath;
      });

      const prefix = 'ab';
      // For every assignment that is applied, add the corresponding body class.
      toApply.forEach(a => {
        if (a.assigned_variant !== '0') {
          document.body.classList.add(
            `${prefix}-active`,
            `${prefix}-${a.testId}`,
            `${prefix}-${a.testId}-${a.assigned_variant}`
          );
        } else {
          document.body.classList.add(`${prefix}-${a.testId}-0`);
        }
      });
    }

    // Dedicated function to track exposure events separate from assignment creation.
    async trackExposureEvents() {
      try {
        const assignments = this.assignmentManager.getAllAssignments() || [];
        for (const a of assignments) {
          await window.postgresReporter.trackExposureEvent(a);
        }
      } catch (err) {
        console.error('Failed to track exposure events:', err);
      }
    }
  }

  window.ABTestManager = ABTestManager;

  const waitForDeps = () => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const max = 50;
      const check = () => {
        attempts++;
        if (window.TrackingCore && document.body) {
          resolve();
          return;
        }
        if (attempts >= max) {
          reject(new Error('Deps not found after max attempts'));
          return;
        }
        if (document.readyState === 'complete' && !window.TrackingCore) {
          reject(new Error('No TrackingCore after page load'));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  };

  const initSystem = async () => {
    try {
      await waitForDeps();
      const mgr = new ABTestManager();
      const ok = await mgr.initialize();
    } catch (err) {
      console.error('Failed to init AB Testing System:', err);
    }
  };

  if (window.abTestingConfig?.enabled) {
    initSystem();
  }
})();