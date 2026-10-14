import type { Window as NativeWindow } from '@tauri-apps/api/window';
import type { AppAction, PreferenceDefinition, PublicAction, Contract, Dependency, Destination } from '../../sdk/src';
export type { PreferenceValues, PreferenceDefinition, ShortcutOwner, ShortcutBinding } from '../../sdk/src';

export type ResizeDirection = Parameters<NativeWindow['startResizeDragging']>[0];
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Capture {
  dataUrl: string;
  width: number;
  height: number;
}

export interface OpenPayload {
  tool: string;
  capture?: Capture | null;
}

export type Provider = 'openai' | 'compatible' | 'anthropic';

export interface Settings {
  provider: Provider;
  baseUrl: string;
  model: string;
  agentEnabled: boolean;
  agentExecutable: string;
}

export interface SettingsStatus {
  settings: Settings;
  hasKey: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  image?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface StreamEvent {
  requestId: string;
  kind: 'delta' | 'done' | 'error' | 'cancelled';
  text: string;
}

export interface ToolContext {
  launch: (id: string) => Promise<void>;
  hide: () => Promise<void>;
  notify: (message: string, kind?: 'info' | 'error') => void;
  launchPackage: (id: string) => Promise<void>;
  appSettings: (id: string) => void;
}

export interface PackageManifest {
  id: string; name: string; description: string; version: string; sdk: number;
  entry: string; permissions: string[]; shortcut: string | null;
  actions?: AppAction[]; preferences?: PreferenceDefinition[]; icon?: string | null;
  exports?: PublicAction[]; contracts?: Contract[]; dependencies?: Dependency[];
  window?: { width: number; height: number };
  network?: { connect: string[] };
  widgets?: import('../../sdk/src').WidgetDeclaration[];
}
export interface InstalledApp { manifest: PackageManifest; enabled: boolean; hidden?: boolean; previousVersion: string | null; shortcutOverride?: string | null; actionShortcuts?: Record<string, string> }
export interface DependencyStatus { id: string; ready: boolean; dependencies: { contract: string; version: number; required: boolean; providers: Destination[] }[] }
export interface PackagePreview { manifest: PackageManifest; digest: string }

export interface ToolProps {
  context: ToolContext;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
