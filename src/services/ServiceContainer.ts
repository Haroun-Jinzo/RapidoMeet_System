/**
 * Service Container (Dependency Injection)
 * 
 * This module implements a service locator pattern for managing application
 * dependencies. Instead of having modules directly import each other (tight coupling),
 * they request dependencies from the container (loose coupling).
 * 
 * Benefits:
 * - Easier to mock services in tests
 * - Centralized initialization logic
 * - Services can be swapped without changing code
 * - Circular dependency prevention
 * 
 * Usage:
 *   const container = ServiceContainer.getInstance();
 *   const transcriber = container.getTranscriber();
 */

import {
  ITranscriber,
  ITaskExtractor,
  IIntentRouter,
  IMCPDispatcher,
} from '../interfaces';

/** Interface for the session manager service */
interface ISessionManager {
  getSession(sessionId: string): Promise<any>;
  saveSession(sessionId: string, data: any): Promise<void>;
}

/** Interface for the skill registry service */
interface ISkillRegistry {
  getSkill(name: string): Promise<any>;
  listSkills(): Promise<string[]>;
}

/** Interface for the memory manager service */
interface IMemoryManager {
  store(key: string, value: any): Promise<void>;
  retrieve(key: string): Promise<any>;
  delete(key: string): Promise<void>;
}

/**
 * Service Container: Central registry for all application services
 * Implements singleton pattern - only one instance exists per application
 */
export class ServiceContainer {
  private static instance: ServiceContainer;

  // Service instances
  private transcriber: ITranscriber | null = null;
  private taskExtractor: ITaskExtractor | null = null;
  private intentRouter: IIntentRouter | null = null;
  private mcpDispatcher: IMCPDispatcher | null = null;
  private sessionManager: ISessionManager | null = null;
  private skillRegistry: ISkillRegistry | null = null;
  private memoryManager: IMemoryManager | null = null;

  /**
   * Private constructor prevents direct instantiation
   * Use getInstance() instead
   */
  private constructor() {}

  /**
   * Get the singleton instance of ServiceContainer
   * Creates the instance on first call, returns existing on subsequent calls
   * 
   * @returns The singleton ServiceContainer instance
   */
  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  /**
   * Register a transcriber service implementation
   * This should be called during application initialization
   * 
   * @param transcriber - Implementation of ITranscriber interface
   */
  setTranscriber(transcriber: ITranscriber): void {
    this.transcriber = transcriber;
  }

  /**
   * Get the registered transcriber service
   * Throws error if not initialized
   * 
   * @returns The transcriber service instance
   * @throws Error if not registered
   */
  getTranscriber(): ITranscriber {
    if (!this.transcriber) {
      throw new Error('Transcriber not initialized in service container');
    }
    return this.transcriber;
  }

  /**
   * Register a task extractor service implementation
   */
  setTaskExtractor(extractor: ITaskExtractor): void {
    this.taskExtractor = extractor;
  }

  /**
   * Get the registered task extractor service
   */
  getTaskExtractor(): ITaskExtractor {
    if (!this.taskExtractor) {
      throw new Error('TaskExtractor not initialized in service container');
    }
    return this.taskExtractor;
  }

  /**
   * Register an intent router service implementation
   */
  setIntentRouter(router: IIntentRouter): void {
    this.intentRouter = router;
  }

  /**
   * Get the registered intent router service
   */
  getIntentRouter(): IIntentRouter {
    if (!this.intentRouter) {
      throw new Error('IntentRouter not initialized in service container');
    }
    return this.intentRouter;
  }

  /**
   * Register an MCP dispatcher service implementation
   */
  setMCPDispatcher(dispatcher: IMCPDispatcher): void {
    this.mcpDispatcher = dispatcher;
  }

  /**
   * Get the registered MCP dispatcher service
   */
  getMCPDispatcher(): IMCPDispatcher {
    if (!this.mcpDispatcher) {
      throw new Error('MCPDispatcher not initialized in service container');
    }
    return this.mcpDispatcher;
  }

  /**
   * Register a session manager service implementation
   */
  setSessionManager(manager: ISessionManager): void {
    this.sessionManager = manager;
  }

  /**
   * Get the registered session manager service
   */
  getSessionManager(): ISessionManager {
    if (!this.sessionManager) {
      throw new Error('SessionManager not initialized in service container');
    }
    return this.sessionManager;
  }

  /**
   * Register a skill registry service implementation
   */
  setSkillRegistry(registry: ISkillRegistry): void {
    this.skillRegistry = registry;
  }

  /**
   * Get the registered skill registry service
   */
  getSkillRegistry(): ISkillRegistry {
    if (!this.skillRegistry) {
      throw new Error('SkillRegistry not initialized in service container');
    }
    return this.skillRegistry;
  }

  /**
   * Register a memory manager service implementation
   */
  setMemoryManager(manager: IMemoryManager): void {
    this.memoryManager = manager;
  }

  /**
   * Get the registered memory manager service
   */
  getMemoryManager(): IMemoryManager {
    if (!this.memoryManager) {
      throw new Error('MemoryManager not initialized in service container');
    }
    return this.memoryManager;
  }

  /**
   * Check if all required services are initialized
   * Useful for startup validation
   * 
   * @returns true if all services are registered
   */
  isFullyInitialized(): boolean {
    return (
      this.transcriber !== null &&
      this.taskExtractor !== null &&
      this.intentRouter !== null &&
      this.mcpDispatcher !== null &&
      this.sessionManager !== null &&
      this.skillRegistry !== null &&
      this.memoryManager !== null
    );
  }

  /**
   * Get diagnostic information about container state
   * Useful for logging during startup or troubleshooting
   */
  getDiagnostics(): {
    isFullyInitialized: boolean;
    initializedServices: string[];
    missingServices: string[];
  } {
    const initialized: string[] = [];
    const missing: string[] = [];

    if (this.transcriber) initialized.push('transcriber');
    else missing.push('transcriber');

    if (this.taskExtractor) initialized.push('taskExtractor');
    else missing.push('taskExtractor');

    if (this.intentRouter) initialized.push('intentRouter');
    else missing.push('intentRouter');

    if (this.mcpDispatcher) initialized.push('mcpDispatcher');
    else missing.push('mcpDispatcher');

    if (this.sessionManager) initialized.push('sessionManager');
    else missing.push('sessionManager');

    if (this.skillRegistry) initialized.push('skillRegistry');
    else missing.push('skillRegistry');

    if (this.memoryManager) initialized.push('memoryManager');
    else missing.push('memoryManager');

    return {
      isFullyInitialized: this.isFullyInitialized(),
      initializedServices: initialized,
      missingServices: missing,
    };
  }

  /**
   * Reset all services (useful for testing or graceful shutdown)
   */
  reset(): void {
    this.transcriber = null;
    this.taskExtractor = null;
    this.intentRouter = null;
    this.mcpDispatcher = null;
    this.sessionManager = null;
    this.skillRegistry = null;
    this.memoryManager = null;
  }
}
