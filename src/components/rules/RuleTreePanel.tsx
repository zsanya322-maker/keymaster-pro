import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderPlus,
  Keyboard,
  MoreHorizontal,
  Mouse,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FrontendRule, FrontendTrigger, RuleFolder } from '../../lib/types';
import { formatKeyChord, vkToName } from '../../lib/keyCodes';

export interface RuleMoveTarget {
  folderId: string | null;
  beforeRuleId?: string;
}

export interface FolderMoveTarget {
  parentId: string | null;
  beforeFolderId?: string;
}

interface RuleTreePanelProps {
  title: string;
  rules: FrontendRule[];
  folders: RuleFolder[];
  selectedRuleId: string | null;
  query: string;
  saving?: boolean;
  onSelectRule: (rule: FrontendRule) => void;
  onCreateRule: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: RuleFolder) => void;
  onDeleteFolder: (folder: RuleFolder) => void;
  onDuplicateRule: (rule: FrontendRule) => void;
  onToggleRule: (rule: FrontendRule) => void;
  onDeleteRule: (rule: FrontendRule) => void;
  onMoveRule: (ruleId: string, target: RuleMoveTarget) => void;
  onMoveFolder: (folderId: string, target: FolderMoveTarget) => void;
}

type DragNode =
  | { type: 'rule'; id: string }
  | { type: 'folder'; id: string };

type MenuState =
  | { kind: 'rule'; x: number; y: number; rule: FrontendRule }
  | { kind: 'folder'; x: number; y: number; folder: RuleFolder }
  | null;

function triggerText(trigger: FrontendTrigger): string {
  switch (trigger.type) {
    case 'keyDown':
    case 'keyUp':
      return formatKeyChord({ code: trigger.code, modifiers: trigger.modifiers });
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'mouseDown':
    case 'mouseUp':
      return vkToName(trigger.code);
    case 'typedText':
      return `“${trigger.sequence}”`;
  }
}

function triggerIcon(trigger: FrontendTrigger) {
  if (trigger.type === 'typedText') return FileText;
  if (trigger.type === 'mouseDown' || trigger.type === 'mouseUp') return Mouse;
  return Keyboard;
}

function setDragData(event: React.DragEvent, node: DragNode) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-keymaster-node', JSON.stringify(node));
}

function getDragData(event: React.DragEvent): DragNode | null {
  try {
    const raw = event.dataTransfer.getData('application/x-keymaster-node');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragNode;
    if ((parsed.type === 'rule' || parsed.type === 'folder') && typeof parsed.id === 'string') return parsed;
  } catch {
    // Ignore malformed external drag data.
  }
  return null;
}

function MenuButton({ icon, children, danger, onClick }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 w-full px-2 flex items-center gap-2 text-left text-[10px] hover:bg-app-surface ${danger ? 'text-app-danger' : 'text-app-text'}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function RuleTreePanel({
  title,
  rules,
  folders,
  selectedRuleId,
  query,
  saving = false,
  onSelectRule,
  onCreateRule,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDuplicateRule,
  onToggleRule,
  onDeleteRule,
  onMoveRule,
  onMoveFolder,
}: RuleTreePanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const close = () => {
      setMenu(null);
      setAddOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const visibleFolderIds = useMemo(() => {
    if (!query.trim()) return new Set(folders.map((folder) => folder.id));
    const result = new Set<string>();
    const byId = new Map(folders.map((folder) => [folder.id, folder]));

    for (const rule of rules) {
      let folderId = rule.folderId ?? null;
      while (folderId) {
        if (result.has(folderId)) break;
        result.add(folderId);
        folderId = byId.get(folderId)?.parentId ?? null;
      }
    }
    return result;
  }, [folders, query, rules]);

  const folderChildren = useMemo(() => {
    const map = new Map<string | null, RuleFolder[]>();
    for (const folder of folders) {
      if (!visibleFolderIds.has(folder.id)) continue;
      const parent = folder.parentId ?? null;
      const list = map.get(parent) ?? [];
      list.push(folder);
      map.set(parent, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return map;
  }, [folders, visibleFolderIds]);

  const ruleChildren = useMemo(() => {
    const map = new Map<string | null, FrontendRule[]>();
    for (const rule of rules) {
      const parent = rule.folderId ?? null;
      const list = map.get(parent) ?? [];
      list.push(rule);
      map.set(parent, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || (a.name ?? '').localeCompare(b.name ?? ''));
    return map;
  }, [rules]);

  const toggleFolder = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMenu = (event: React.MouseEvent, next: Exclude<MenuState, null>) => {
    event.preventDefault();
    event.stopPropagation();
    setAddOpen(false);
    setMenu(next);
  };

  const dropOnRoot = (event: React.DragEvent) => {
    event.preventDefault();
    const node = getDragData(event);
    if (!node) return;
    if (node.type === 'rule') onMoveRule(node.id, { folderId: null });
    else onMoveFolder(node.id, { parentId: null });
  };

  const renderRule = (rule: FrontendRule, depth: number) => {
    const Icon = triggerIcon(rule.trigger);
    const selected = selectedRuleId === rule.id;
    return (
      <div
        key={rule.id}
        draggable={!saving}
        onDragStart={(event) => setDragData(event, { type: 'rule', id: rule.id })}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const node = getDragData(event);
          if (!node) return;
          const targetFolder = rule.folderId ?? null;
          if (node.type === 'rule') {
            if (node.id !== rule.id) onMoveRule(node.id, { folderId: targetFolder, beforeRuleId: rule.id });
          } else {
            onMoveFolder(node.id, { parentId: targetFolder });
          }
        }}
        onContextMenu={(event) => openMenu(event, { kind: 'rule', x: event.clientX, y: event.clientY, rule })}
        className={`group relative min-h-[42px] border-b border-app-border/45 ${selected ? 'bg-app-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]' : 'hover:bg-app-surface/35'} ${rule.enabled ? '' : 'opacity-50'}`}
      >
        <button
          type="button"
          disabled={saving}
          onClick={() => onSelectRule(rule)}
          className="w-full min-h-[42px] pr-7 py-1 flex items-center gap-1.5 text-left disabled:opacity-50"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <Icon size={12} className={`shrink-0 ${selected ? 'text-app-primary' : 'text-app-muted'}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] leading-4 font-medium text-app-text truncate">
              {rule.name?.trim() || triggerText(rule.trigger)}
            </span>
            <span className="block text-[9px] leading-4 text-app-muted truncate">
              {triggerText(rule.trigger)}
            </span>
          </span>
          {!rule.enabled && <X size={10} className="text-app-muted shrink-0" />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(event, { kind: 'rule', x: rect.right - 4, y: rect.bottom + 2, rule });
          }}
          className="absolute right-1 top-2 h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-text"
          title={t('rules.tree.more', { defaultValue: 'Действия' })}
        >
          <MoreHorizontal size={12} />
        </button>
      </div>
    );
  };

  const renderFolder = (folder: RuleFolder, depth: number): React.ReactNode => {
    const childFolders = folderChildren.get(folder.id) ?? [];
    const childRules = ruleChildren.get(folder.id) ?? [];
    const isCollapsed = collapsed.has(folder.id) && !query.trim();
    const childCount = childFolders.length + childRules.length;

    return (
      <React.Fragment key={folder.id}>
        <div
          draggable={!saving}
          onDragStart={(event) => setDragData(event, { type: 'folder', id: folder.id })}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const node = getDragData(event);
            if (!node) return;
            if (node.type === 'rule') onMoveRule(node.id, { folderId: folder.id });
            else if (node.id !== folder.id) onMoveFolder(node.id, { parentId: folder.id });
            setCollapsed((current) => {
              const next = new Set(current);
              next.delete(folder.id);
              return next;
            });
          }}
          onContextMenu={(event) => openMenu(event, { kind: 'folder', x: event.clientX, y: event.clientY, folder })}
          className="group relative h-7 border-b border-app-border/45 bg-app-surface/20 hover:bg-app-surface/45"
        >
          <button
            type="button"
            disabled={saving}
            onClick={() => toggleFolder(folder.id)}
            className="w-full h-7 pr-7 flex items-center gap-1 text-left disabled:opacity-50"
            style={{ paddingLeft: 5 + depth * 14 }}
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            <Folder size={12} className="text-app-muted shrink-0" />
            <span className="text-[10px] font-semibold text-app-text truncate">{folder.name}</span>
            <span className="ml-auto mr-1 text-[8px] font-mono text-app-muted">{childCount || ''}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(event, { kind: 'folder', x: rect.right - 4, y: rect.bottom + 2, folder });
            }}
            className="absolute right-1 top-1 h-5 w-5 opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-text"
            title={t('rules.tree.more', { defaultValue: 'Действия' })}
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
        {!isCollapsed && childFolders.map((child) => renderFolder(child, depth + 1))}
        {!isCollapsed && childRules.map((rule) => renderRule(rule, depth + 1))}
      </React.Fragment>
    );
  };

  const roots = folderChildren.get(null) ?? [];
  const rootRules = ruleChildren.get(null) ?? [];

  return (
    <section className="w-[34%] min-w-[300px] max-w-[455px] flex flex-col border-r border-app-border bg-app-bg min-h-0">
      <div className="h-9 px-2.5 flex items-center border-b border-app-border bg-app-surface/35 shrink-0">
        <h2 className="text-[11px] font-semibold text-app-text">{title}</h2>
        {query && <span className="ml-2 text-[9px] text-app-primary truncate">“{query}”</span>}
        <span className="ml-auto text-[9px] font-mono text-app-muted">{rules.length}</span>
        <div className="relative ml-1" onMouseDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            disabled={saving}
            onClick={() => setAddOpen((value) => !value)}
            className="h-5 w-5 inline-flex items-center justify-center text-app-muted hover:text-app-primary hover:bg-app-surface disabled:opacity-40"
            title={t('rules.tree.add', { defaultValue: 'Добавить' })}
          >
            <Plus size={12} />
          </button>
          {addOpen && (
            <div className="absolute z-40 right-0 top-6 w-40 border border-app-border bg-app-bg shadow-lg py-1">
              <MenuButton icon={<Plus size={11} />} onClick={() => { setAddOpen(false); onCreateRule(null); }}>
                {t('rules.add_rule')}
              </MenuButton>
              <MenuButton icon={<FolderPlus size={11} />} onClick={() => { setAddOpen(false); onCreateFolder(null); }}>
                {t('rules.tree.new_folder', { defaultValue: 'Новая папка' })}
              </MenuButton>
            </div>
          )}
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto"
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropOnRoot}
      >
        {roots.map((folder) => renderFolder(folder, 0))}
        {rootRules.map((rule) => renderRule(rule, 0))}

        {rules.length === 0 && roots.length === 0 && (
          <div className="py-7 px-4 text-center text-[10px] text-app-muted">
            {query ? t('rules.search_empty') : t('rules.empty_state')}
          </div>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={() => onCreateRule(null)}
          className="w-full h-8 px-2 text-left text-[10px] text-app-muted hover:text-app-primary hover:bg-app-surface/45 flex items-center gap-1.5 border-b border-app-border/45 disabled:opacity-40"
        >
          <Plus size={11} />
          {t('rules.add_rule')}
        </button>
      </div>

      <div className="h-7 px-2.5 flex items-center border-t border-app-border bg-app-surface/25 text-[9px] text-app-muted shrink-0">
        {t('rules.total_rules')}: <strong className="ml-1 font-mono text-app-text">{rules.length}</strong>
        {folders.length > 0 && (
          <span className="ml-3">{t('rules.tree.folders', { defaultValue: 'Папки' })}: <strong className="font-mono text-app-text">{folders.length}</strong></span>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-[10010] min-w-44 border border-app-border bg-app-bg shadow-xl py-1"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 190) }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {menu.kind === 'rule' ? (
            <>
              <MenuButton icon={menu.rule.enabled ? <X size={11} /> : <Check size={11} />} onClick={() => { onToggleRule(menu.rule); setMenu(null); }}>
                {menu.rule.enabled
                  ? t('rules.tree.disable', { defaultValue: 'Отключить' })
                  : t('rules.tree.enable', { defaultValue: 'Включить' })}
              </MenuButton>
              <MenuButton icon={<Copy size={11} />} onClick={() => { onDuplicateRule(menu.rule); setMenu(null); }}>
                {t('rules.tree.duplicate', { defaultValue: 'Дублировать' })}
              </MenuButton>
              <MenuButton danger icon={<Trash2 size={11} />} onClick={() => { onDeleteRule(menu.rule); setMenu(null); }}>
                {t('rules.delete_rule')}
              </MenuButton>
            </>
          ) : (
            <>
              <MenuButton icon={<Plus size={11} />} onClick={() => { onCreateRule(menu.folder.id); setMenu(null); }}>
                {t('rules.tree.new_rule_here', { defaultValue: 'Новое правило здесь' })}
              </MenuButton>
              <MenuButton icon={<FolderPlus size={11} />} onClick={() => { onCreateFolder(menu.folder.id); setMenu(null); }}>
                {t('rules.tree.new_subfolder', { defaultValue: 'Новая подпапка' })}
              </MenuButton>
              <MenuButton icon={<Pencil size={11} />} onClick={() => { onRenameFolder(menu.folder); setMenu(null); }}>
                {t('rules.tree.rename', { defaultValue: 'Переименовать' })}
              </MenuButton>
              <MenuButton danger icon={<Trash2 size={11} />} onClick={() => { onDeleteFolder(menu.folder); setMenu(null); }}>
                {t('rules.tree.delete_folder', { defaultValue: 'Удалить папку' })}
              </MenuButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}
