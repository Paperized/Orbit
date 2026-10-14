import manifest from '../../shared/tools.json';
import Home from '../tools/Workspace.svelte';
import CaptureTool from '../tools/CaptureTool.svelte';
import Chat from '../tools/Chat.svelte';
import Notes from '../tools/Notes.svelte';
import Settings from '../tools/Settings.svelte';
import Catalog from '../tools/Catalog.svelte';
import type { Component } from 'svelte';
import type { ToolProps } from './types';

const views = { home: Home, capture: CaptureTool, chat: Chat, notes: Notes, settings: Settings, catalog: Catalog } satisfies Record<string, Component<ToolProps>>;
export type ToolId = keyof typeof views;

function isToolId(id: string): id is ToolId { return id in views; }
export const tools = manifest.map(tool => {
  if (!isToolId(tool.id)) throw new Error(`Vista mancante per lo strumento: ${tool.id}`);
  return { ...tool, id: tool.id, component: views[tool.id] };
});

export function getTool(id: string) {
  const tool = tools.find(tool => tool.id === id);
  if (!tool) throw new Error(`Strumento sconosciuto: ${id}`);
  return tool;
}
