export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface KdfRpcEnvelope {
  method: string;
  mmrpc?: string;
  userpass?: string;
  [key: string]: JsonValue | undefined;
}

export interface KdfRpcError {
  error?: string;
  error_message?: string;
  message?: string;
}

export interface UiApiResponse<T> {
  ok: boolean;
  data?: T;
  message?: string;
  fetchedAt: string;
}
