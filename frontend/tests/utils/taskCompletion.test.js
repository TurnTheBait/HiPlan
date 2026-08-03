import { describe, it, expect } from 'vitest';
import { calculateTaskEffHours, isTaskCompleted } from '../../src/utils/taskCompletion';

describe('taskCompletion utils', () => {
  describe('calculateTaskEffHours', () => {
    it('returns 0 for missing or invalid actual_hours', () => {
      expect(calculateTaskEffHours(null)).toBe(0);
      expect(calculateTaskEffHours({})).toBe(0);
      expect(calculateTaskEffHours({ actual_hours: 'not-an-object' })).toBe(0);
    });

    it('calculates total effective hours correctly', () => {
      const task = {
        actual_hours: {
          '2026-08-01': { 'user1': 4, 'user2': 2 },
          '2026-08-02': { 'user1': 2 }
        }
      };
      expect(calculateTaskEffHours(task)).toBe(8);
    });
  });

  describe('isTaskCompleted', () => {
    it('returns true if task is explicitly completed', () => {
      expect(isTaskCompleted({ completed: 1 })).toBe(true);
      expect(isTaskCompleted({ progress: 1 })).toBe(true);
    });

    it('returns false if task is explicitly marked incomplete', () => {
      expect(isTaskCompleted({ completed: -1, progress: 1 })).toBe(false);
    });

    it('calculates completion based on effective vs planned hours', () => {
      const task = {
        planned_hours: 10,
        actual_hours: {
          'date1': { 'user1': 10 }
        }
      };
      expect(isTaskCompleted(task)).toBe(true);

      const taskIncomplete = {
        planned_hours: 10,
        actual_hours: {
          'date1': { 'user1': 5 }
        }
      };
      expect(isTaskCompleted(taskIncomplete)).toBe(false);
    });
  });
});
