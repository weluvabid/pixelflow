# Chronos

A browser-based time coordination engine. It has 100,000 timers running, managed
by a dedicated Web Worker. It displays a limited, scrollable view of the timers
using Canvas 2D.

The main principle is that there is no need to track a timer interval or
maintain a counter. Just track when the timer was started and calculate the
elapsed time using a single monotonic clock.

## How it works

Timers are tracked using timestamps. All timers store a `startedAt` value using
a `Float64Array`. The elapsed time is calculated using `now - startedAt`. There
is no ticking or updating of the 100,000 timers.

**Monotonic clock.** The worker uses `performance.timeOrigin +
performance.now()` to get a timestamp based on a monotonic clock. The
performance clock keeps returned timestamps from moving backwards by clamping
them to the last observed value. The manual clock rejects attempts to move
backwards and is used for deterministic testing and simulations.

Timers are stored in a compact registry. Each timer has a handle, which is a
number used to index into a dynamic typed array. All active timers are tracked,
and invalid handles or invalid clock values result in an explicit failure.

Deadlines are stored in an indexed binary min-heap using typed arrays. Adding
and removing items is O(log n), and getting the next deadline is O(1). Deadlines
can be cancelled using an ID. The worker sets a timeout for the next deadline
and clears any due events in batches.

The worker manages the engine, timers, simulation and scheduler. A versioned
request/response system is used to ensure messages are valid, with explicit
error handling for invalid or unsupported requests.

The UI only asks for a section of the timers based on what is visible. The
worker returns a slice of the `Float64Array` and transfers the buffer.

Canvas 2D is used to draw only visible rows plus some overscan. This gives the
scrollable matrix a logical height without creating 100,000 DOM elements.
Rendering is handled using `requestAnimationFrame`.

The workload is deterministic. The 100,000 timers are created using a seeded
generator. The workload names and status indicators are static labels based on
the timer handle. They are not indicative of the state of the service.
