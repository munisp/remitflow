package circuitbreaker

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

// State represents the circuit breaker state
type State int

const (
    StateClosed State = iota
    StateHalfOpen
    StateOpen
)

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
    name            string
    maxRequests     uint32
    interval        time.Duration
    timeout         time.Duration
    readyToTrip     func(counts Counts) bool
    onStateChange   func(name string, from State, to State)
    
    mutex      sync.Mutex
    state      State
    generation uint64
    counts     Counts
    expiry     time.Time
}

// Counts holds the numbers of requests and their successes/failures
type Counts struct {
    Requests             uint32
    TotalSuccesses       uint32
    TotalFailures        uint32
    ConsecutiveSuccesses uint32
    ConsecutiveFailures  uint32
}

// Settings configures a CircuitBreaker
type Settings struct {
    Name          string
    MaxRequests   uint32
    Interval      time.Duration
    Timeout       time.Duration
    ReadyToTrip   func(counts Counts) bool
    OnStateChange func(name string, from State, to State)
}

// NewCircuitBreaker returns a new CircuitBreaker configured with the given Settings
func NewCircuitBreaker(st Settings) *CircuitBreaker {
    cb := &CircuitBreaker{
        name:        st.Name,
        maxRequests: st.MaxRequests,
        interval:    st.Interval,
        timeout:     st.Timeout,
        readyToTrip: st.ReadyToTrip,
        onStateChange: st.OnStateChange,
    }
    
    if cb.maxRequests == 0 {
        cb.maxRequests = 1
    }
    
    if cb.interval <= 0 {
        cb.interval = time.Duration(0)
    }
    
    if cb.timeout <= 0 {
        cb.timeout = 60 * time.Second
    }
    
    if cb.readyToTrip == nil {
        cb.readyToTrip = func(counts Counts) bool {
            return counts.ConsecutiveFailures > 5
        }
    }
    
    cb.toNewGeneration(time.Now())
    
    return cb
}

// Name returns the name of the CircuitBreaker
func (cb *CircuitBreaker) Name() string {
    return cb.name
}

// State returns the current state of the CircuitBreaker
func (cb *CircuitBreaker) State() State {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, _ := cb.currentState(now)
    return state
}

// Counts returns a copy of the internal Counts
func (cb *CircuitBreaker) Counts() Counts {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    return cb.counts
}

// Execute runs the given request if the CircuitBreaker accepts it
func (cb *CircuitBreaker) Execute(req func() (interface{}, error)) (interface{}, error) {
    generation, err := cb.beforeRequest()
    if err != nil {
        return nil, err
    }
    
    defer func() {
        e := recover()
        if e != nil {
            cb.afterRequest(generation, false)
            panic(e)
        }
    }()
    
    result, err := req()
    cb.afterRequest(generation, err == nil)
    return result, err
}

// ExecuteWithContext runs the given request with context if the CircuitBreaker accepts it
func (cb *CircuitBreaker) ExecuteWithContext(ctx context.Context, req func(context.Context) (interface{}, error)) (interface{}, error) {
    generation, err := cb.beforeRequest()
    if err != nil {
        return nil, err
    }
    
    defer func() {
        e := recover()
        if e != nil {
            cb.afterRequest(generation, false)
            panic(e)
        }
    }()
    
    // Create a channel to receive the result
    resultChan := make(chan struct {
        result interface{}
        err    error
    }, 1)
    
    go func() {
        defer func() {
            if e := recover(); e != nil {
                resultChan <- struct {
                    result interface{}
                    err    error
                }{nil, fmt.Errorf("panic: %v", e)}
            }
        }()
        
        result, err := req(ctx)
        resultChan <- struct {
            result interface{}
            err    error
        }{result, err}
    }()
    
    select {
    case res := <-resultChan:
        cb.afterRequest(generation, res.err == nil)
        return res.result, res.err
    case <-ctx.Done():
        cb.afterRequest(generation, false)
        return nil, ctx.Err()
    }
}

// beforeRequest is called before a request
func (cb *CircuitBreaker) beforeRequest() (uint64, error) {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, generation := cb.currentState(now)
    
    if state == StateOpen {
        return generation, errors.New("circuit breaker is open")
    } else if state == StateHalfOpen && cb.counts.Requests >= cb.maxRequests {
        return generation, errors.New("circuit breaker is half-open and max requests reached")
    }
    
    cb.counts.onRequest()
    return generation, nil
}

// afterRequest is called after a request
func (cb *CircuitBreaker) afterRequest(before uint64, success bool) {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, generation := cb.currentState(now)
    if generation != before {
        return
    }
    
    if success {
        cb.onSuccess(state, now)
    } else {
        cb.onFailure(state, now)
    }
}

// onSuccess is called on successful requests
func (cb *CircuitBreaker) onSuccess(state State, now time.Time) {
    cb.counts.onSuccess()
    
    if state == StateHalfOpen {
        cb.setState(StateClosed, now)
    }
}

// onFailure is called on failed requests
func (cb *CircuitBreaker) onFailure(state State, now time.Time) {
    cb.counts.onFailure()
    
    if cb.readyToTrip(cb.counts) {
        cb.setState(StateOpen, now)
    }
}

// currentState returns the current state
func (cb *CircuitBreaker) currentState(now time.Time) (State, uint64) {
    switch cb.state {
    case StateClosed:
        if !cb.expiry.IsZero() && cb.expiry.Before(now) {
            cb.toNewGeneration(now)
        }
    case StateOpen:
        if cb.expiry.Before(now) {
            cb.setState(StateHalfOpen, now)
        }
    }
    return cb.state, cb.generation
}

// setState sets the state
func (cb *CircuitBreaker) setState(state State, now time.Time) {
    if cb.state == state {
        return
    }
    
    prev := cb.state
    cb.state = state
    
    cb.toNewGeneration(now)
    
    if cb.onStateChange != nil {
        cb.onStateChange(cb.name, prev, state)
    }
}

// toNewGeneration creates a new generation
func (cb *CircuitBreaker) toNewGeneration(now time.Time) {
    cb.generation++
    cb.counts.clear()
    
    var zero time.Time
    switch cb.state {
    case StateClosed:
        if cb.interval == 0 {
            cb.expiry = zero
        } else {
            cb.expiry = now.Add(cb.interval)
        }
    case StateOpen:
        cb.expiry = now.Add(cb.timeout)
    default: // StateHalfOpen
        cb.expiry = zero
    }
}

// onRequest increments the request count
func (c *Counts) onRequest() {
    c.Requests++
}

// onSuccess increments the success count
func (c *Counts) onSuccess() {
    c.TotalSuccesses++
    c.ConsecutiveSuccesses++
    c.ConsecutiveFailures = 0
}

// onFailure increments the failure count
func (c *Counts) onFailure() {
    c.TotalFailures++
    c.ConsecutiveFailures++
    c.ConsecutiveSuccesses = 0
}

// clear resets the counts
func (c *Counts) clear() {
    c.Requests = 0
    c.TotalSuccesses = 0
    c.TotalFailures = 0
    c.ConsecutiveSuccesses = 0
    c.ConsecutiveFailures = 0
}

// String returns a string representation of the state
func (s State) String() string {
    switch s {
    case StateClosed:
        return "closed"
    case StateHalfOpen:
        return "half-open"
    case StateOpen:
        return "open"
    default:
        return fmt.Sprintf("unknown state: %d", s)
    }
}

// CircuitBreakerManager manages multiple circuit breakers
type CircuitBreakerManager struct {
    breakers map[string]*CircuitBreaker
    mutex    sync.RWMutex
}

// NewCircuitBreakerManager creates a new circuit breaker manager
func NewCircuitBreakerManager() *CircuitBreakerManager {
    return &CircuitBreakerManager{
        breakers: make(map[string]*CircuitBreaker),
    }
}

// GetOrCreate gets an existing circuit breaker or creates a new one
func (cbm *CircuitBreakerManager) GetOrCreate(name string, settings Settings) *CircuitBreaker {
    cbm.mutex.Lock()
    defer cbm.mutex.Unlock()
    
    if cb, exists := cbm.breakers[name]; exists {
        return cb
    }
    
    settings.Name = name
    cb := NewCircuitBreaker(settings)
    cbm.breakers[name] = cb
    return cb
}

// Get gets an existing circuit breaker
func (cbm *CircuitBreakerManager) Get(name string) (*CircuitBreaker, bool) {
    cbm.mutex.RLock()
    defer cbm.mutex.RUnlock()
    
    cb, exists := cbm.breakers[name]
    return cb, exists
}

// GetAll returns all circuit breakers
func (cbm *CircuitBreakerManager) GetAll() map[string]*CircuitBreaker {
    cbm.mutex.RLock()
    defer cbm.mutex.RUnlock()
    
    result := make(map[string]*CircuitBreaker)
    for name, cb := range cbm.breakers {
        result[name] = cb
    }
    return result
}

// Remove removes a circuit breaker
func (cbm *CircuitBreakerManager) Remove(name string) {
    cbm.mutex.Lock()
    defer cbm.mutex.Unlock()
    
    delete(cbm.breakers, name)
}
