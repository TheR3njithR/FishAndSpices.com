export function requestCurrentPosition({ geolocation = globalThis.navigator?.geolocation, isSecureContext = globalThis.isSecureContext, timeout = 10000 } = {}) {
  if (!isSecureContext || !geolocation?.getCurrentPosition) return Promise.resolve({ status: 'unavailable' });
  return new Promise(resolve => {
    geolocation.getCurrentPosition(position => {
      const latitude = Number(position.coords?.latitude);
      const longitude = Number(position.coords?.longitude);
      const accuracyMetres = Number(position.coords?.accuracy);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracyMetres) || accuracyMetres <= 0) {
        resolve({ status: 'unavailable' });
        return;
      }
      resolve({ status: 'granted', location: { latitude, longitude, accuracyMetres: Math.max(1, accuracyMetres) } });
    }, error => {
      resolve({ status: error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable' });
    }, { enableHighAccuracy: false, timeout, maximumAge: 0 });
  });
}
