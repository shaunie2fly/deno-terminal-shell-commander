# VSCode Copilot Instructions

## Project Context
This is a Deno TypeScript project that follows specific conventions and best practices. When assisting with this codebase, consider these project characteristics:

- **Runtime**: Deno (not Node.js)
- **Language**: TypeScript with strict typing
- **Database**: PostgreSQL with connection pooling
- **Structure**: Repository/Service pattern

## Import & Dependency Guidelines

### Follow these import patterns:
- Always define external package imports in deno.json under the "imports" section
- Reference external packages using the import map aliases defined in deno.json
- Always use explicit file extensions (`.ts`) in imports
- Use JSR repository for Deno packages when available, but define them in deno.json first

### Example Imports:

First, define packages in deno.json:
```json
{
  "imports": {
    "@std/collections": "jsr:@std/collections@1.0.0",
    "@std/datetime": "jsr:@std/datetime@0.178.0",
    "@bartlomieju/postgres": "jsr:@bartlomieju/postgres@0.17.2",
    "@app": "./src"
  }
}
```

Then import using the defined aliases:
```typescript
// Use import maps for all external packages
import { difference } from "@std/collections";
import { format } from "@std/datetime";
import { Pool } from "@bartlomieju/postgres";

// Internal imports with explicit file extensions
import { UserService } from "@app/services/user.service.ts";
```

Avoid direct package imports like:
```typescript
// ❌ Don't import packages directly
import { difference } from "jsr:@std/collections@1.0.0";
import { format } from "https://deno.land/std@0.178.0/datetime/format.ts";
```

## Code Structure & Patterns

### Documentation
- All code must be documented using TSDoc:
  ```typescript
  /**
   * Retrieves a recipe by its unique identifier
   * @param id - The unique identifier of the recipe
   * @returns The recipe object if found, null otherwise
   * @throws DatabaseError if connection fails
   */
  async getRecipeById(id: string): Promise<Recipe | null> {
    // Implementation
  }
  ```

### Type Definitions & Validation
- Use the runtypes library for type definitions and runtime validations
- Define all types using runtypes with appropriate constraints
- Validate input values using runtypes before processing
- Follow this pattern for type definitions:
  ```typescript
  import * as rt from 'runtypes';

  // Define the runtype
  const RecipeData = rt.Record({
    title: rt.String.withConstraint(t => t.length > 0 || 'Title cannot be empty'),
    servings: rt.Number.withConstraint(n => n > 0 || 'Servings must be greater than 0'),
    ingredients: rt.Array(rt.String).withConstraint(arr => 
      arr.length > 0 || 'Recipe must have at least one ingredient'
    )
  });

  // Create TypeScript type from runtype
  type Recipe = rt.Static<typeof RecipeData>;

  // Export both the runtype validator and the TypeScript type
  export type RecipeTypes = {
    Recipe: Recipe;
  };

  export default {
    RecipeData
  };
  ```

### For database operations:
- Use repository classes for database access
- Always release connections back to the pool using try/finally blocks
- Use parameterized queries to prevent SQL injection
- Wrap multi-step database operations in transactions

### For business logic:
- Implement service classes that use repository classes
- Inject dependencies through constructors
- Use interfaces for better testability and type safety

### For testing:
- Use Deno's built-in test framework with `Deno.test` API
- Organize tests with the step API
- Use `assertRejects` for testing error cases

## Environment Variables
- Load environment variables using `load()` from `jsr:@std/dotenv`
- Access variables with `Deno.env.get("VARIABLE_NAME")`

## When Suggesting Code

1. **Prioritize Type Safety**:
   - Always use runtypes for type definitions and validations
   - Create explicit runtime validations with meaningful error messages 
   - Use `rt.Static<typeof TypeName>` for TypeScript types
   - Implement constraint checks for all user inputs

2. **Ensure Proper Documentation**:
   - Add TSDoc comments to all functions, classes, and interfaces
   - Include parameter descriptions, return types, and thrown exceptions
   - Document constraints and business rules in comments

3. **Follow Project Patterns**:
   - Match existing naming conventions
   - Apply consistent formatting and structure
   - Use dependency injection for testability

4. **Apply Error Handling**:
   - Include try/catch blocks for critical operations
   - Release database connections in finally blocks
   - Provide meaningful error messages
   - Validate inputs using runtypes before processing

5. **Include Security Practices**:
   - Use Deno's permissions system when applicable
   - Validate user inputs with runtypes before processing
   - Use parameterized queries for database operations

## Implementation Planning
Before writing any code, provide a clear step-by-step execution plan:

1. **Present an Execution Plan First**:
   - When asked to implement a feature or fix an issue, first outline the complete execution plan
   - Break down complex tasks into discrete steps
   - Identify potential edge cases and challenges before coding begins
   - Explain your reasoning for architectural decisions

2. **Include Type Definition Strategy**:
   - Outline which runtypes will be created and what constraints they'll include
   - Explain validation approach for user inputs
   - Show how the types will be exported and used

3. **Wait for Confirmation**:
   - After presenting the plan, wait for confirmation before proceeding with implementation
   - This allows for course correction before investing time in coding

4. **Implementation Steps**:
   - Once the plan is approved, follow these implementation steps:
     - Create runtype definitions with constraints first
     - Generate TypeScript types from runtypes using rt.Static
     - Implement repository classes if database access is needed
     - Implement service classes for business logic with TSDoc documentation
     - Add appropriate error handling and runtypes validation
     - Write tests for the new functionality

## Documentation Organization

### Documentation Structure
- Store all project documentation in the `documents/` folder
- Follow a clear hierarchy:
  ```
  documents/
  ├── api/           # API documentation
  ├── architecture/  # Architecture decisions and patterns
  ├── guides/        # Development guides and tutorials
  └── features/      # Feature-specific documentation
  ```

### Documentation Updates
- Create or update documentation files alongside code changes
- Document new features in both TSDoc comments and dedicated markdown files
- For significant changes:
  1. Update relevant API documentation
  2. Add architecture decision records if patterns change
  3. Update development guides if processes change
  4. Document feature specifications in the features folder

### Documentation Guidelines
- Use Markdown format for all documentation files
- Include code examples when applicable
- Keep documentation close to the code it describes
- Create new documentation categories as needed
- Link related documentation files using relative paths
- Update table of contents in README files when adding new documents

## Before Finalizing Solutions
- Verify import paths follow project conventions
- Ensure all database connections are properly released
- Check for proper error handling
- Confirm type safety throughout the implementation
- Make sure code follows existing patterns in the codebase
- Present a concise summary of the changes made and how they address the requirements
- Highlight any potential areas for future improvement or refactoring
- Update relevant documentation in the documents/ folder