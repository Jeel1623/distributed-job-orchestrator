let baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
  baseUrl = `https://${baseUrl}/api`;
}
const API_BASE_URL = baseUrl;

export interface APIError {
  code: string;
  message: string;
  details?: any;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const accessToken = localStorage.getItem('access_token');

  const headers = new Headers(options.headers || {});
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && path !== '/auth/login' && path !== '/auth/register') {
    // Attempt token refresh
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      // Retry request once
      const retryToken = localStorage.getItem('access_token');
      headers.set('Authorization', `Bearer ${retryToken}`);
      const retryResponse = await fetch(url, { ...options, headers });
      if (retryResponse.ok) {
        return retryResponse.json() as Promise<T>;
      }
    } else {
      // Force logout
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.dispatchEvent(new Event('auth-logout'));
    }
  }

  if (!response.ok) {
    let errBody: { error?: APIError } = {};
    try {
      errBody = await response.json();
    } catch (e) {
      // Ignore
    }
    throw {
      code: errBody.error?.code || 'HTTP_ERROR',
      message: errBody.error?.message || `Request failed with status ${response.status}`,
      details: errBody.error?.details
    };
  }

  // Handle empty or JSON responses
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function attemptTokenRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (res.ok) {
      const data = await res.json() as { accessToken: string; refreshToken: string };
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      return true;
    }
  } catch (e) {
    console.error('Failed to refresh authentication token:', e);
  }

  return false;
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, options?: RequestInit) => request<T>(path, { ...options, method: 'DELETE' })
};

export default api;
