/* Assignment Manager
  Stores AB test assignments in localStorage
  Dependencies: TrackingCore */

(() => {
  if (window.TestAssignment || window.AssignmentManager) {
    console.warn('Assignment Manager already loaded, skipping initialization');
    return;
  }
 
  // Add preview mode detection
  const isPreviewMode = () => window.location?.hostname?.indexOf('myshopify') > -1;
 
  class TestAssignment {
    constructor(testId, data) {
      try {
        this.testId = testId;
        this.type = data.type;
        this.mode = data.mode;
        this.pageGroup = data.pageGroup;
        this.timestamp = Date.now();
        this.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
        this.assigned_variant = data.assigned_variant;
      } catch (err) {
        console.error('Failed to create assignment:', err);
        throw err;
      }
    }
 
    validateInput(testId, data) {
      if (!testId) throw new Error('TestId is required');
      if (!data) throw new Error('Assignment data required');
      const req = ['assigned_variant', 'type', 'mode', 'pageGroup'];
      const missing = req.filter(f => !data[f]);
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }
    }
 
    isValid() {
      try {
        const required = ['testId', 'assigned_variant', 'type', 'mode', 'pageGroup', 'timestamp'];
        const hasAll = required.every(f => this[f] !== undefined);
        const notExpired = (Date.now() - this.timestamp) < (30 * 24 * 60 * 60 * 1000);
        return hasAll && notExpired;
      } catch(err) {
        console.error('Validation error:', err);
        return false;
      }
    }
 
    toStorageFormat() {
      return {
        testId: this.testId,
        type: this.type,
        mode: this.mode,
        pageGroup: this.pageGroup,
        timestamp: this.timestamp,
        assigned_variant: this.assigned_variant,
        tested_variant: this.tested_variant
      };
    }
 
    toPixelFormat() {
      return {
        testId: this.testId,
        type: this.type,
        mode: this.mode,
        group: this.pageGroup,
        tested_variant: this.tested_variant,
        assigned_variant: this.assigned_variant
      };
    }
 
    static fromStorage(data) {
      try {
        if (!data?.testId) {
          return null;
        }
        const asg = new TestAssignment(data.testId, data);
        asg.tested_variant = data.tested_variant !== undefined ? data.tested_variant : null;
        asg.assigned_variant = data.assigned_variant || data.variant; // Fallback for legacy data
        return asg;
      } catch (err) {
        console.error('Failed to create assignment from storage:', err);
        return null;
      }
    }
  }
 
  class AssignmentManager {
    constructor() {
      if (AssignmentManager.instance) {
        return AssignmentManager.instance;
      }
      try {
        this.setupCore();
        AssignmentManager.instance = this;
      } catch (err) {
        console.error('Failed to init Assignment Manager:', err);
        throw err;
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
      
      // Only load from storage if not in preview mode
      if (!isPreviewMode()) {
        this.loadFromStorage();
      }
      
      this.persist();
    }
 
    loadFromStorage() {
      try {
        const stored = localStorage.getItem(this.STORAGE_KEYS.assignments);
        if (stored) {
          const data = JSON.parse(stored);
          Object.entries(data).forEach(([tid, asgData]) => {
            const asg = TestAssignment.fromStorage(asgData);
            if (asg?.isValid()) {
              this.assignments.set(tid, asg);
            }
          });
        }
      } catch (err) {
        console.error('Failed to load assignments:', err);
      }
    }
 
    setAssignment(testId, data) {
      try {
        const asg = new TestAssignment(testId, data);
        this.assignments.set(testId, asg);
        this.persist();
        return asg;
      } catch (err) {
        console.error('Failed to set assignment:', err);
        throw err;
      }
    }
 
    getAssignment(testId) {
      try {
        const asg = this.assignments.get(testId);
        const valid = asg?.isValid();
        return valid ? asg : null;
      } catch(err) {
        console.error('Failed to get assignment:', err);
        return null;
      }
    }
 
    getAllAssignments() {
      try {
        return Array.from(this.assignments.values()).filter(a => a.isValid());
      } catch(err) {
        console.error('Failed to get all assignments:', err);
        return [];
      }
    }
 
    recalculateTestedVariants() {
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
          } else if (nonZeroCount === 1) {
            groupAssignments.forEach(a => {
              if (a.assigned_variant !== "0") {
                a.tested_variant = a.assigned_variant;
              } else {
                a.tested_variant = "excluded";
              }
            });
          } else {
            groupAssignments.forEach(a => {
              a.tested_variant = "excluded";
            });
          }
        });
      } catch (err) {
        console.error('Error recalculating tested_variant:', err);
      }
    }
 
    persist() {
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
      } catch (err) {
        console.error('Failed to persist:', err);
      }
    }
 
    cleanup() {
      try {
        let changed = false;
        this.assignments.forEach((asg, tid) => {
          if (!asg.isValid()) {
            this.assignments.delete(tid);
            changed = true;
          }
        });
        if (changed) {
          this.persist();
        }
      } catch (err) {
        console.error('Failed to cleanup assignments:', err);
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