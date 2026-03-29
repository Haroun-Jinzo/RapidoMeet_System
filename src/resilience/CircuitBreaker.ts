/**
 * Circuit Breaker Pattern Implementation
 * 
 * The circuit breaker pattern prevents cascading failures by:
 * 1. CLOSED state: Normal operation, calls go through
 * 2. OPEN state: After N failures, circuit opens and fails immediately (fast-fail)
 * 3. HALF_OPEN state: After timeout, tries one call to see if service recovered
 * 
 * This protects against retry storms and unresponsive external services.
 * Use for: Groq API, Gemini API, N8N webhooks, database calls, etc.
 */

/**
 * Possible states of a circuit breaker
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Failing fast, rejecting calls
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;  // How many failures before opening (e.g., 5)
  successThreshold: number;  // How many successes in HALF_OPEN before closing (e.g., 2)
  timeout: number;           // How long to wait before trying again in ms (e.g., 60000)
}

/**
 * Generic circuit breaker class for protecting external service calls
 * 
 * Example usage:
 *   const groqBreaker = new CircuitBreaker('groq-api', config);
 *   
 *   async function transcribe() {
 *     return groqBreaker.execute(async () => {
 *       return await groq.audio.transcriptions.create(...);
 *     });
 *   }
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;

  constructor(
    private serviceName: string,
    private config: CircuitBreakerConfig
  ) {}

  /**
   * Execute a function with circuit breaker protection
   * 
   * @param fn - The async function to execute (e.g., API call)
   * @returns Promise that resolves to the result or rejects if circuit is open
   * @throws Error with "Circuit breaker is OPEN" if service is failing
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // If circuit is OPEN, reject immediately without calling fn
    if (this.state === CircuitBreakerState.OPEN) {
      // Check if it's time to try recovery (HALF_OPEN transition)
      if (this.shouldAttemptReset()) {
        console.log(
          `[CircuitBreaker] ${this.serviceName} transitioning to HALF_OPEN, attempting recovery...`
        );
        this.state = CircuitBreakerState.HALF_OPEN;
        this.successCount = 0;
      } else {
        // Still in failure window, reject fast
        throw new Error(
          `Circuit breaker for ${this.serviceName} is OPEN. Service is failing.`
        );
      }
    }

    try {
      // Execute the actual function
      const result = await fn();

      // ✅ SUCCESS: Record it
      this.onSuccess();
      return result;
    } catch (error) {
      // ❌ FAILURE: Record it
      this.onFailure();
      throw error;
    }
  }

  /**
   * Returns true if enough time has passed to try recovery
   */
  private shouldAttemptReset(): boolean {
    const timeSinceFailure = Date.now() - this.lastFailureTime;
    return timeSinceFailure >= this.config.timeout;
  }

  /**
   * Handle successful execution
   * Reset failure counter or transition HALF_OPEN → CLOSED
   */
  private onSuccess(): void {
    this.failureCount = 0;

    // If we're in HALF_OPEN state, track successes
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        console.log(
          `[CircuitBreaker] ${this.serviceName} recovered. Transitioning to CLOSED.`
        );
        this.state = CircuitBreakerState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  /**
   * Handle failed execution
   * Transition CLOSED → OPEN if threshold exceeded
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      console.warn(
        `[CircuitBreaker] ${this.serviceName} failure threshold reached (${this.failureCount}/${this.config.failureThreshold}). Opening circuit.`
      );
      this.state = CircuitBreakerState.OPEN;
    }

    // Reset HALF_OPEN back to OPEN on failure
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.successCount = 0;
    }
  }

  /**
   * Get current state for monitoring/debugging
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get diagnostic information
   */
  getStatus(): {
    state: string;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset circuit (useful for testing or emergency recovery)
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    console.log(`[CircuitBreaker] ${this.serviceName} manually reset.`);
  }
}

/**
 * Factory for creating pre-configured circuit breakers for all services
 * This ensures consistent failure handling across the application
 */
export class CircuitBreakerRegistry {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for a service
   */
  static getBreaker(
    serviceName: string,
    config: CircuitBreakerConfig
  ): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, config));
    }
    return this.breakers.get(serviceName)!;
  }

  /**
   * Get all breaker statuses for monitoring dashboard
   */
  static getAllStatus(): Record<string, CircuitBreaker> {
    return Object.fromEntries(this.breakers);
  }

  /**
   * Reset all breakers (useful during application restart)
   */
  static resetAll(): void {
    this.breakers.forEach((breaker) => breaker.reset());
  }
}
