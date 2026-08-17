/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** wi-admin base URL including the version segment, e.g. http://localhost:8033/api/v1 */
    readonly VITE_API_BASE_URL?: string;
    /** App display name. */
    readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
