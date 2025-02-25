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
    console.log('All AB Testing deps loaded');
    return true;
  };

  if (!checkDependencies()) {
    console.error('Cannot init AB Testing - missing deps');
    return;
  }

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
      } catch (err) {
        console.error('Failed to init AB Testing:', err);
        throw err;
      } finally {
        console.groupEnd();
      }
    }

    setupCore() {
      console.group('Setting up core');
      this.core = new TrackingCore();
      this.assignmentManager = new AssignmentManager();
      // Use window.abTestingConfig (populated by our Liquid snippet)
      this.settings = window.abTestingConfig || {};
      console.log('Settings loaded:', this.settings);
      console.groupEnd();
    }

    setupState() {
      console.group('Setting up state');
      this.allTests = [];
      const { userId, sessionId } = this.core.getTrackingIds();
      this.userId = userId;
      this.sessionId = sessionId;
      console.log('State:', { userId, sessionId });
      console.groupEnd();
    }

    async initialize() {
      console.group('Initializing Test System');
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
        await this.trackExposureEvents();
        return true;
      } catch (err) {
        console.error('Failed to initialize:', err);
        return false;
      } finally {
        console.groupEnd();
      }
    }

    loadActiveTestsFromSettings() {
      console.group('Loading Tests from Settings');
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

        console.log('All tests from settings:', this.allTests);
      } catch (err) {
        console.error('Error loading tests:', err);
      } finally {
        console.groupEnd();
      }
    }

    assignAllGroups() {
      console.group('Assigning variants for each group');
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

      console.groupEnd();
    }

    assignGroup(group, tests) {
      console.group(`Assigning group="${group}":`, tests);

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
        console.log(`No unforced tests for group=${group}`);
        console.groupEnd();
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
      console.log(`Group=${group}, traffic=${traffic}, fraction=${fraction}`);
      const rng = Math.random();
      console.log(`rng=${rng}, group=${group}`);

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
            console.log(`Test ${testObj.id} => chosen variant=${finalVar}`);

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

      console.groupEnd();
    }

    // Check for an existing valid assignment before setting a new one.
    setOrKeepAssignment(testObj, data) {
      console.group(`Setting/Updating Assignment for ${testObj.id}`);
      const existingAssignment = this.assignmentManager.getAssignment(testObj.id);
      if (existingAssignment) {
        console.log(`Existing valid assignment found for test ${testObj.id}:`, existingAssignment);
      } else {
        this.assignmentManager.setAssignment(testObj.id, data);
      }
      console.groupEnd();
    }

    // Apply assignments by adding corresponding body classes.
    applyAssignments() {
      console.group('Applying Assignments');
      if (!document.body) {
        console.warn('No document.body');
        console.groupEnd();
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
      console.log('Current normalized path:', currentPath);

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
      console.log('Current template:', currentTemplate);

      const standardGroups = ['global', currentTemplate];
      console.log('Standard groups for apply:', standardGroups);

      // Get all valid assignments.
      const assts = this.assignmentManager.getAllAssignments() || [];
      const toApply = assts.filter(a => {
        if (standardGroups.includes(a.pageGroup)) {
          return true;
        }
        return getPath(a.pageGroup) === currentPath;
      });
      console.log('Assignments to apply:', toApply);

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

      console.groupEnd();
    }

    // Dedicated function to track exposure events separate from assignment creation.
    async trackExposureEvents() {
      console.group('Tracking Exposure Events');
      try {
        const assignments = this.assignmentManager.getAllAssignments() || [];
        for (const a of assignments) {
          console.log(`Tracking exposure for test ${a.testId}`);
          await window.postgresReporter.trackExposureEvent(a);
        }
        console.log('Exposure events tracked successfully');
      } catch (err) {
        console.error('Failed to track exposure events:', err);
      } finally {
        console.groupEnd();
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
          console.log('Dependencies OK after', attempts, 'attempts');
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
    console.group('Initializing System');
    try {
      await waitForDeps();
      console.log('Deps available, creating ABTestManager');
      const mgr = new ABTestManager();
      const ok = await mgr.initialize();
      console.log('AB Testing init complete:', { success: ok });
    } catch (err) {
      console.error('Failed to init AB Testing System:', err);
    } finally {
      console.groupEnd();
    }
  };

  if (window.abTestingConfig?.enabled) {
    console.log('Starting AB Testing System initialization');
    initSystem();
  }
})();
