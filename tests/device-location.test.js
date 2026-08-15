import { describe, expect, it, vi } from 'vitest';
import { requestCurrentPosition } from '../assets/js/device-location.js';

function geolocationResult(result) {
  return {
    getCurrentPosition: vi.fn((success, failure, options) => {
      if (result.position) success(result.position);
      else failure(result.error);
      expect(options).toEqual({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
    }),
    watchPosition: vi.fn()
  };
}

describe('optional device location', () => {
  it('accepts one current position only after the caller invokes the action', async () => {
    const geolocation = geolocationResult({ position: { coords: { latitude: 9.9312, longitude: 76.2673, accuracy: 42 } } });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await expect(requestCurrentPosition({ geolocation, isSecureContext: true })).resolves.toEqual({
      status: 'granted', location: { latitude: 9.9312, longitude: 76.2673, accuracyMetres: 42 }
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('reports denial without throwing or blocking manual form completion', async () => {
    const geolocation = geolocationResult({ error: { code: 1 } });
    await expect(requestCurrentPosition({ geolocation, isSecureContext: true })).resolves.toEqual({ status: 'denied' });
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('handles timeout and unavailable or non-HTTPS environments', async () => {
    await expect(requestCurrentPosition({ geolocation: geolocationResult({ error: { code: 3 } }), isSecureContext: true })).resolves.toEqual({ status: 'timeout' });
    await expect(requestCurrentPosition({ geolocation: null, isSecureContext: true })).resolves.toEqual({ status: 'unavailable' });
    await expect(requestCurrentPosition({ geolocation: geolocationResult({ position: {} }), isSecureContext: false })).resolves.toEqual({ status: 'unavailable' });
  });
});
