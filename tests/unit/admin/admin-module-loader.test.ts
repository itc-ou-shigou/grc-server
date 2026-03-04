/**
 * Unit tests for src/module-loader.ts — Admin module registration map
 *
 * Tests that the module loader is configured with the correct set of modules
 * and that the adminModuleMap covers all 6 expected modules.
 *
 * Since the module maps are defined inside the `loadModules` function scope
 * (not exported), we test by reading the source file and verifying the expected
 * module keys are present. This is a structural / configuration test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MODULE_LOADER_PATH = resolve(__dirname, '../../../src/module-loader.ts');

const expectedModuleKeys = ['auth', 'clawhub', 'evolution', 'update', 'telemetry', 'community'];

describe('module-loader structure', () => {
  const source = readFileSync(MODULE_LOADER_PATH, 'utf-8');

  describe('moduleMap', () => {
    it('contains entries for all 6 modules', () => {
      for (const key of expectedModuleKeys) {
        // Check that the moduleMap has entries like: auth: () =>
        const pattern = new RegExp(`['"]?${key}['"]?\\s*:\\s*\\(\\)`);
        expect(source).toMatch(pattern);
      }
    });

    it('imports routes.js for each module', () => {
      for (const key of expectedModuleKeys) {
        const importPattern = `./modules/${key}/routes.js`;
        expect(source).toContain(importPattern);
      }
    });
  });

  describe('adminModuleMap', () => {
    it('contains entries for all 6 admin modules', () => {
      // The adminModuleMap block should reference all 6 modules
      for (const key of expectedModuleKeys) {
        const importPattern = `./modules/${key}/admin-routes.js`;
        expect(source).toContain(importPattern);
      }
    });

    it('has matching keys between moduleMap and adminModuleMap', () => {
      // Extract keys from both maps by looking for the key patterns
      // moduleMap keys appear as: key: () => import("./modules/key/routes.js")
      const moduleMapKeys = expectedModuleKeys.filter((key) => {
        return source.includes(`./modules/${key}/routes.js`);
      });

      const adminModuleMapKeys = expectedModuleKeys.filter((key) => {
        return source.includes(`./modules/${key}/admin-routes.js`);
      });

      expect(moduleMapKeys).toEqual(adminModuleMapKeys);
    });

    it('has exactly 6 admin module entries', () => {
      // Count occurrences of admin-routes.js imports
      const adminImportMatches = source.match(/admin-routes\.js/g);
      expect(adminImportMatches).not.toBeNull();
      expect(adminImportMatches!.length).toBe(6);
    });
  });

  describe('loadModules function', () => {
    it('exports the loadModules function', () => {
      expect(source).toContain('export async function loadModules');
    });

    it('accepts Express app and GrcConfig parameters', () => {
      expect(source).toMatch(/loadModules\s*\(\s*\n?\s*app:\s*Express/);
    });

    it('returns loaded module keys as string array', () => {
      expect(source).toContain('Promise<string[]>');
    });

    it('calls registerAdmin for admin modules', () => {
      expect(source).toContain('adminMod.registerAdmin(app, config)');
    });

    it('handles module load failures gracefully (does not re-throw)', () => {
      // The loader catches errors and continues, it should have a try-catch with continue
      expect(source).toContain('Failed to load module');
      expect(source).toContain('continue');
    });

    it('handles admin route failures gracefully', () => {
      expect(source).toContain('Failed to load admin routes');
    });

    it('checks module enabled state from config', () => {
      expect(source).toContain('config.modules');
    });
  });

  describe('GrcAdminModule interface', () => {
    it('defines registerAdmin method', () => {
      expect(source).toContain('registerAdmin: (app: Express, config: GrcConfig) => Promise<void>');
    });
  });

  describe('GrcModule interface', () => {
    it('defines name and register fields', () => {
      expect(source).toContain('name: string');
      expect(source).toContain('register: (app: Express, config: GrcConfig) => Promise<void>');
    });
  });
});
