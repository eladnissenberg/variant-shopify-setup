/* Assignment Manager
   Stores AB test assignments in localStorage
   Dependencies: TrackingCore */

   (() => {
    if (window.TestAssignment || window.AssignmentManager) {
      console.warn('Assignment Manager already loaded, skipping initialization');
      return;
    }
  
    class TestAssignment {
      constructor(testId, data) {
        console.group('Creating Test Assignment');
        try {
          this.testId = testId;
          this.variant = data.variant;
          this.type = data.type;
          this.mode = data.mode;
          this.pageGroup = data.pageGroup;
          this.timestamp = Date.now();
          this.name = data.name || '';
          this.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
          this.assigned_variant = data.assigned_variant || this.variant;
  
          console.log('Created assignment:', this.toStorageFormat());
        } catch (err) {
          console.error('Failed to create assignment:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      validateInput(testId, data) {
        if (!testId) throw new Error('TestId is required');
        if (!data) throw new Error('Assignment data required');
        const req = ['variant', 'type', 'mode', 'pageGroup'];
        const missing = req.filter(f => !data[f]);
        if (missing.length > 0) {
          throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
      }
  
      isValid() {
        console.group('Validating Assignment');
        try {
          const required = ['testId', 'variant', 'type', 'mode', 'pageGroup', 'timestamp'];
          const hasAll = required.every(f => this[f] !== undefined);
          const notExpired = (Date.now() - this.timestamp) < (30 * 24 * 60 * 60 * 1000);
          const isValid = hasAll && notExpired;
          console.log('Validation result:', { isValid, hasAll, notExpired });
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
        console.group('Creating Assignment from Storage');
        try {
          if (!data?.testId) {
            console.log('Invalid storage data');
            return null;
          }
          const asg = new TestAssignment(data.testId, data);
          asg.name = data.name ? data.name : '';
          asg.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
          asg.assigned_variant = data.assigned_variant || data.variant;
          console.log('Created assignment from storage:', asg);
          return asg;
        } catch (err) {
          console.error('Failed to create assignment from storage:', err);
          return null;
        } finally {
          console.groupEnd();
        }
      }
    }
  
    class AssignmentManager {
      constructor() {
        console.group('Initializing Assignment Manager');
        if (AssignmentManager.instance) {
          console.log('Returning existing instance');
          console.groupEnd();
          return AssignmentManager.instance;
        }
        try {
          this.setupCore();
          AssignmentManager.instance = this;
          console.log('Assignment Manager initialized successfully');
        } catch (err) {
          console.error('Failed to init Assignment Manager:', err);
          throw err;
        } finally {
          console.groupEnd();
        }
      }
  
      setupCore() {
        if (typeof TrackingCore === 'undefined') {
          throw new Error('TrackingCore not found');
        }
        this.STORAGE_KEYS = {
          assignments: 'hw-abt-assignments',
          activeTests: 'pg_active_tests'
        };
        this.assignments = new Map();
        this.core = new TrackingCore();
        this.loadFromStorage();
        this.persist();
      }
  
      loadFromStorage() {
        console.group('Loading Assignments from Storage');
        try {
          const stored = localStorage.getItem(this.STORAGE_KEYS.assignments);
          console.log('Raw storage data:', stored);
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
          console.log('Loaded assignments:', Array.from(this.assignments.entries()));
        } catch (err) {
          console.error('Failed to load assignments:', err);
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
          console.log('Assignment set successfully:', asg);
          return asg;
        } catch (err) {
          console.error('Failed to set assignment:', err);
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
          console.log('Assignment retrieval:', { found: !!asg, valid, asg });
          return valid ? asg : null;
        } finally {
          console.groupEnd();
        }
      }
  
      getAllAssignments() {
        console.group('Getting All Assignments');
        try {
          const valid = Array.from(this.assignments.values()).filter(a => a.isValid());
          console.log('Valid assignments:', valid);
          return valid;
        } finally {
          console.groupEnd();
        }
      }
  
      recalculateTestedVariants() {
        console.group('Recalculating tested_variant for all assignments by page group');
        try {
          const groups = {};
          this.assignments.forEach(assignment => {
            const group = assignment.pageGroup || 'default';
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
          console.error('Error recalculating tested_variant:', err);
        } finally {
          console.groupEnd();
        }
      }
  
      persist() {
        console.group('Persisting Assignments');
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
          console.log('Persisted data:', { storageData, pixelData });
        } catch (err) {
          console.error('Failed to persist:', err);
        } finally {
          console.groupEnd();
        }
      }
  
      cleanup() {
        console.group('Cleaning Up Assignments');
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
            console.log('Persisted changes after cleanup');
          } else {
            console.log('No cleanup needed');
          }
        } catch (err) {
          console.error('Failed to cleanup assignments:', err);
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
      console.error('Failed to initialize shared Assignment Manager:', err);
    }
  })();