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
  
        // Instead of Liquid settings, we'll use window.abTestingConfig
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
  
          // 4) Track them
          await this.trackTestAssignments();
  
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
          // For page-specific tests, we preserve the original location and set the location
          // to the merchant-defined URL.
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
            // For page-specific tests, if a URL is provided, override location with that URL.
            let location = originalLocation;
            if (originalLocation === "page_specific" && test.page_specific_url) {
              location = test.page_specific_url;
            }
  
            return {
              id: test.id,
              mode: testMode,
              forcedVariant,
              location: location,           // For page-specific, this is the actual URL.
              originalLocation: originalLocation, // Preserve original value.
              device: test.device || 'both',
              testName: test.name || '',
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
            variant: forcedVar,
            assigned_variant: forcedVar,
            tested_variant: forcedVar,
            type: (forcedVar === '0') ? 'control' : 'test',
            mode: (forcedVar === '0') ? 'forced-0' : 'forced',
            pageGroup: group,
            name: ft.testName || ''
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
        // For standard groups, use the global traffic config.
        // For page-specific tests (where originalLocation === "page_specific"),
        // use the traffic value from the global traffic config under the key "page_specific".
        const trafficConfig = this.settings.traffic || {};
        let traffic;
        if (unforcedTests[0].originalLocation === "page_specific") {
          traffic = parseInt(trafficConfig["page_specific"] || '0', 10) || 0;
        } else {
          const standardGroups = ['global', 'product', 'collection', 'cart', 'checkout'];
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
              variant: '0',
              assigned_variant: '0',
              tested_variant: '0',
              type: 'control',
              mode: 'pure-control',
              pageGroup: group,
              name: t.testName || ''
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
                variant: finalVar,
                assigned_variant: finalVar,
                tested_variant: finalVar,
                type: 'test',
                mode: 'probabilistic',
                pageGroup: group,
                name: testObj.testName || ''
              };
              this.setOrKeepAssignment(testObj, assignmentData);
            } else {
              const assignmentData = {
                variant: '0',
                assigned_variant: '0',
                tested_variant: '0',
                type: 'control',
                mode: 'excluded',
                pageGroup: group,
                name: testObj.testName || ''
              };
              this.setOrKeepAssignment(testObj, assignmentData);
            }
          });
        }
  
        console.groupEnd();
      }
  
      setOrKeepAssignment(testObj, data) {
        console.group(`Setting/Updating Assignment for ${testObj.id}`);
        this.assignmentManager.setAssignment(testObj.id, data);
        console.groupEnd();
      }
  
      applyAssignments() {
        console.group('Applying Assignments');
        if (!document.body) {
          console.warn('No document.body');
          console.groupEnd();
          return;
        }
  
        // Helper: extract a normalized path from a URL or a relative path.
        const getPath = (str) => {
          try {
            // If str is a full URL, extract its pathname.
            let url = new URL(str);
            return url.pathname.replace(/\/+$/, '');
          } catch (e) {
            // Otherwise, ensure it starts with '/' and remove trailing slashes.
            if (!str.startsWith('/')) {
              str = '/' + str;
            }
            return str.replace(/\/+$/, '');
          }
        };
  
        // Get the current page's normalized path.
        const currentPath = getPath(window.location.href);
        console.log('Current normalized path:', currentPath);
  
        // Determine current template/group from URL or data attribute.
        let currentTemplate = document.body.getAttribute('data-template') ||
                              window.location.pathname.split('/')[1] || 'home';
  
        const templateToGroup = {
          product: 'product',
          collection: 'collection',
          cart: 'cart',
          checkout: 'checkout',
          index: 'home'
        };
  
        const mappedGroup = templateToGroup[currentTemplate] || 'home';
        const standardGroups = ['global', mappedGroup];
        console.log('Standard groups for apply:', standardGroups);
  
        const assts = this.assignmentManager.getAllAssignments() || [];
        const toApply = assts.filter(a => {
          // If the assignment's pageGroup is one of the standard groups, apply it.
          if (standardGroups.includes(a.pageGroup)) {
            return true;
          }
          // Otherwise, treat it as a page-specific URL and compare normalized paths.
          return getPath(a.pageGroup) === currentPath;
        });
        console.log('Assignments to apply:', toApply);
  
        const prefix = 'ab';
        toApply.forEach(a => {
          if (a.variant !== '0') {
            document.body.classList.add(
              `${prefix}-active`,
              `${prefix}-${a.testId}`,
              `${prefix}-${a.testId}-${a.variant}`
            );
            // Create a safe class name from pageGroup by replacing non-alphanumeric characters.
            const safePageGroup = a.pageGroup.replace(/[^a-zA-Z0-9-_]/g, '-');
            document.body.classList.add(`${prefix}-${safePageGroup}`);
          } else {
            document.body.classList.add(`${prefix}-${a.testId}-0`);
          }
        });
  
        console.groupEnd();
      }
  
      async trackTestAssignments() {
        console.group('Tracking Test Assignments');
        try {
          if (!window.postgresReporter) {
            throw new Error('PostgreSQL reporter not found');
          }
          const assts = this.assignmentManager.getAllAssignments() || [];
          console.log('Tracking assignments:', assts);
  
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
  
            // Push to dataLayer if available
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push({
              abTest: {
                testId: a.testId,
                variant: a.variant,
                mode: a.mode
              }
            });
          }
          console.log('Test assignments tracked successfully');
        } catch (err) {
          console.error('Failed to track test assignments:', err);
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
  
    // Initialize if abTestingConfig is enabled
    if (window.abTestingConfig?.enabled) {
      console.log('Starting AB Testing System initialization');
      initSystem();
    }
  })();
  