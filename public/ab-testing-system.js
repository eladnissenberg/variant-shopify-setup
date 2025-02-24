// AB Testing System
(() => {
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
      // Use the configuration injected into window.abTestingConfig via Liquid.
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
        // Clean up any expired assignments.
        this.assignmentManager.cleanup();

        // 1) Load tests from configuration.
        await this.loadActiveTestsFromSettings();

        // 2) Group tests and assign variants.
        this.assignAllGroups();

        // 3) Immediately add body classes and persist assignments.
        this.applyAssignments();

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
        const tests = this.settings.tests || [];
        this.allTests = tests.map(test => {
          const modeValue = String(test.mode || 'test');
          let forcedVariant = null;
          let testMode = 'test';

          if (modeValue === 'test') {
            testMode = 'test';
          } else if (modeValue.startsWith('v')) {
            forcedVariant = modeValue.replace('v', '');
            testMode = 'forced';
          }

          let originalLocation = test.location || 'global';
          let location = originalLocation;
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
            testName: test.name || window.abTestingConfig[test.id + "_name"] || '',
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

      if (unforcedTests.length === 0) {
        console.log(`No unforced tests for group=${group}`);
        console.groupEnd();
        return;
      }

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
      const existingAssignment = this.assignmentManager.getAssignment(testObj.id);
      if (existingAssignment) {
        console.log(`Existing valid assignment found for test ${testObj.id}:`, existingAssignment);
      } else {
        this.assignmentManager.setAssignment(testObj.id, data);
      }
      console.groupEnd();
    }

    // Immediately add body classes and then persist assignments.
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
          if (!str.startsWith('/')) { str = '/' + str; }
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
          currentTemplate = (currentPath.indexOf('/products/') !== -1) ? 'product' : 'collection';
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

      // Get assignments that should be applied on this page.
      const assts = this.assignmentManager.getAllAssignments() || [];
      const toApply = assts.filter(a => {
        if (standardGroups.includes(a.pageGroup)) return true;
        return getPath(a.pageGroup) === currentPath;
      });
      console.log('Assignments to apply:', toApply);

      const prefix = 'ab';
      // Immediately add the corresponding body classes.
      toApply.forEach(a => {
        if (a.variant !== '0') {
          document.body.classList.add(
            `${prefix}-active`,
            `${prefix}-${a.testId}`,
            `${prefix}-${a.testId}-${a.variant}`
          );
        } else {
          document.body.classList.add(`${prefix}-${a.testId}-0`);
        }
      });
      // Persist assignments after applying classes.
      this.assignmentManager.persist();
      console.groupEnd();
    }

    async trackExposureEvents() {
      console.group('Tracking Exposure Events');
      try {
        const assignments = this.assignmentManager.getAllAssignments() || [];
        for (const a of assignments) {
          if (a.exposed !== true) {
            console.log(`Tracking exposure for test ${a.testId}`);
            await window.postgresReporter.trackExposureEvent(a);
            a.exposed = true;
          }
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
      // After the page loads, wait 2 seconds and then:
      window.addEventListener('load', () => {
        setTimeout(() => {
          // First, track exposures as before.
          mgr.trackExposureEvents().then(() => {
            console.log('Exposure events tracked on window load.');
          }).catch(err => {
            console.error('Error tracking exposure events on window load:', err);
          });
          // Now, inspect the body for AB test classes.
          const testPattern = /^ab-([A-Za-z0-9]+)-(\d+)$/;
          const exposedTests = [];
          document.body.classList.forEach(cls => {
            const match = cls.match(testPattern);
            if (match) {
              exposedTests.push({ testId: match[1], variant: match[2] });
            }
          });
          if (exposedTests.length > 0) {
            // Create a separate summary event payload.
            const core = new TrackingCore();
            const ids = core.getTrackingIds();
            const payload = {
              type: 'test_exposure_summary',
              data: {
                session_id: ids.sessionId,
                user_id: ids.userId,
                event_name: 'test_exposure_summary',
                event_type: 'test_exposure_summary',
                client_timestamp: new Date().toISOString(),
                timezone_offset: new Date().getTimezoneOffset(),
                event_data: {
                  exposedTests: exposedTests
                }
              }
            };
            if (window.postgresReporter && typeof window.postgresReporter.queueEvent === 'function') {
              window.postgresReporter.queueEvent(payload);
              console.log('Queued test exposure summary event:', payload);
            } else {
              console.warn('PostgresReporter not available to queue test exposure summary event.');
            }
          } else {
            console.log('No test exposure classes found in body.');
          }
          // Finally, dispatch the "abTestingReady" event.
          console.log('Dispatching "abTestingReady" event.');
          document.dispatchEvent(new CustomEvent("abTestingReady"));
        }, 2000); // 2-second delay after page load
      });
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
