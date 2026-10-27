// ============================================================================
// SCHEMA VALIDATOR (Enterprise Grade)
// ----------------------------------------------------------------------------
// PURPOSE:
// - Validates API JSON responses against a JSON-schema-like structure
// - Supports:
//      * required fields
//      * type checks (string, number, boolean, array, object)
//      * minLength / maxLength (strings)
//      * minimum / maximum (numbers)
//      * enum validation
//      * regex pattern validation
//      * array item validation
//      * nested objects with deep paths
//
// HOW IT WORKS (Flow):
// --------------------
// validate(data, schema)
//      → validateObject()
//          → validateField()
//              → recursively validate nested objects & arrays
//
// WHY IT'S ENTERPRISE-GRADE:
// --------------------------
// ✔ Clean, readable error messages (e.g., "data.user.email is too short")  
// ✔ Automatically logs PASS/FAIL via enterprise logger  
// ✔ Supports deep nested validation  
// ✔ Validator instance shared globally (singleton)  
// ============================================================================

import { logger } from "../helpers/logger";

export class SchemaValidator {
  private static instance: SchemaValidator;
  private log = logger;

  private constructor() {}

  // ----------------------------------------------------------------------------
  // Singleton instance — ensures one global validator
  // ----------------------------------------------------------------------------
  public static getInstance(): SchemaValidator {
    if (!SchemaValidator.instance) {
      SchemaValidator.instance = new SchemaValidator();
    }
    return SchemaValidator.instance;
  }

  // ----------------------------------------------------------------------------
  // MAIN VALIDATE FUNCTION
  // ----------------------------------------------------------------------------
  // HOW IT WORKS:
  // 1. Creates empty error array
  // 2. Delegates to validateObject()
  // 3. Collects any errors
  // 4. Logs final PASS/FAIL
  // ----------------------------------------------------------------------------
  public validate(data: any, schema: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      this.validateObject(data, schema, "", errors);
    } catch (error: any) {
      errors.push(error.message);
    }

    const valid = errors.length === 0;

    if (!valid) {
      this.log.error("❌ Schema validation failed", { errors, received: data });
    } else {
      this.log.debug("✅ Schema validation passed");
    }

    return { valid, errors };
  }

  // ----------------------------------------------------------------------------
  // VALIDATE OBJECTS AND NESTED STRUCTURES
  // ----------------------------------------------------------------------------
  // HOW IT WORKS:
  // - Uses "path" for nested objects: e.g., "data.user.email"
  // - Checks:
  //      * Required fields
  //      * Properties + types
  // ----------------------------------------------------------------------------
  private validateObject(data: any, schema: any, path: string, errors: string[]) {
    if (!schema || typeof schema !== "object") {
      errors.push(`Invalid schema at path: ${path}`);
      return;
    }

    // ------------------------------------------------------------
    // REQUIRED fields check
    // ------------------------------------------------------------
    if (schema.required && Array.isArray(schema.required)) {
      schema.required.forEach((field: string) => {
        if (!(field in data)) {
          errors.push(`Missing required field: ${this.joinPath(path, field)}`);
        }
      });
    }

    // ------------------------------------------------------------
    // Validate each property
    // ------------------------------------------------------------
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        const fieldSchema = schema.properties[key];
        const fullPath = this.joinPath(path, key);

        if (!(key in data)) continue; // required missing already logged

        this.validateField(data[key], fieldSchema, fullPath, errors);
      }
    }
  }

  // ----------------------------------------------------------------------------
  // VALIDATE A SINGLE FIELD (handles nested, arrays, enums, pattern…)
  // ----------------------------------------------------------------------------
  private validateField(value: any, fieldSchema: any, path: string, errors: string[]) {
    const actualType = Array.isArray(value) ? "array" : typeof value;

    // ------------------------------------------------------------
    // TYPE MISMATCH
    // ------------------------------------------------------------
    if (fieldSchema.type && actualType !== fieldSchema.type) {
      errors.push(`Type mismatch at ${path}: expected ${fieldSchema.type}, got ${actualType}`);
      return; // stop further checks
    }

    // ------------------------------------------------------------
    // STRING RULES
    // ------------------------------------------------------------
    if (fieldSchema.type === "string") {
      if (fieldSchema.minLength && value.length < fieldSchema.minLength) {
        errors.push(`${path} is too short (min: ${fieldSchema.minLength})`);
      }

      if (fieldSchema.maxLength && value.length > fieldSchema.maxLength) {
        errors.push(`${path} is too long (max: ${fieldSchema.maxLength})`);
      }

      if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
        errors.push(`${path} does not match pattern: ${fieldSchema.pattern}`);
      }

      if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        errors.push(`${path} should be one of: ${fieldSchema.enum.join(", ")}`);
      }
    }

    // ------------------------------------------------------------
    // NUMBER RULES
    // ------------------------------------------------------------
    if (fieldSchema.type === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} must be a valid number`);
      }

      if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
        errors.push(`${path} is below minimum: ${fieldSchema.minimum}`);
      }

      if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
        errors.push(`${path} exceeds maximum: ${fieldSchema.maximum}`);
      }
    }

    // ------------------------------------------------------------
    // BOOLEAN RULES
    // ------------------------------------------------------------
    if (fieldSchema.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${path} must be a boolean`);
    }

    // ------------------------------------------------------------
    // ARRAY RULES
    // ------------------------------------------------------------
    if (fieldSchema.type === "array") {
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
        return;
      }

      value.forEach((item: any, index: number) => {
        const indexedPath = `${path}[${index}]`;
        this.validateField(item, fieldSchema.items, indexedPath, errors);
      });
    }

    // ------------------------------------------------------------
    // NESTED OBJECT RULES
    // ------------------------------------------------------------
    if (fieldSchema.type === "object" && fieldSchema.properties) {
      this.validateObject(value, fieldSchema, path, errors);
    }
  }

  // ----------------------------------------------------------------------------
  // Builds full nested path like:
  // parent = "data.user", child = "email"
  // → "data.user.email"
  // ----------------------------------------------------------------------------
  private joinPath(parent: string, child: string): string {
    return parent ? `${parent}.${child}` : child;
  }
}

// Export singleton instance
export const schemaValidator = SchemaValidator.getInstance();
