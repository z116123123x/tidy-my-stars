import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  writable: true
});
