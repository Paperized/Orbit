import { writable } from 'svelte/store';

// Retain the selected editor across settings, but not across hub sessions.
export const workspacePage = writable<string | null>(null);
