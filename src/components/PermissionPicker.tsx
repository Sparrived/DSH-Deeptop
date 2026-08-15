import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DshPermissionSelect } from "../lib/desktop";

interface PermissionPickerProps {
  permissions: DshPermissionSelect;
  onSetPermission: (value: string) => void | Promise<unknown>;
  showLabel?: boolean;
}

type PermissionOption = DshPermissionSelect["options"][number];
type PermissionKey = "read-only" | "workspace-write" | "danger-full-access";
type MenuPosition = { top: number; left: number };

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问",
};

const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  "read-only": "可读取和分析内容，不写入文件。",
  "workspace-write": "可读取并修改当前工作区文件，限制工作区外操作。",
  "danger-full-access": "可执行不受限制的文件与外部操作。",
};

const PERMISSION_ORDER: PermissionKey[] = ["read-only", "workspace-write", "danger-full-access"];

function normalizePermissionValue(value: string) {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function permissionKey(option: PermissionOption | undefined): PermissionKey | "" {
  if (!option) return "";
  const value = normalizePermissionValue(option.value);
  if (PERMISSION_ORDER.includes(value as PermissionKey)) return value as PermissionKey;
  const name = normalizePermissionValue(option.name.trim().replace(/\s+/g, "-"));
  return PERMISSION_ORDER.includes(name as PermissionKey) ? name as PermissionKey : "";
}

function visiblePermissionOptions(options: PermissionOption[]) {
  return PERMISSION_ORDER
    .map((key) => options.find((option) => permissionKey(option) === key))
    .filter((option): option is PermissionOption => Boolean(option));
}

export function permissionLabel(option: PermissionOption | undefined) {
  const key = permissionKey(option);
  return key ? PERMISSION_LABELS[key] : "选择权限";
}

export function permissionDescription(option: PermissionOption | undefined) {
  const key = permissionKey(option);
  return key ? PERMISSION_DESCRIPTIONS[key] : option?.description ?? "";
}

export function PermissionPicker({ permissions, onSetPermission, showLabel = false }: PermissionPickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pickerId = useId().replace(/:/g, "");
  const menuId = `permission-menu-${pickerId}`;
  const options = visiblePermissionOptions(permissions.options);
  const currentIndex = options.findIndex((option) => normalizePermissionValue(option.value) === normalizePermissionValue(permissions.currentValue));
  const currentOption = currentIndex >= 0 ? options[currentIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(Math.max(currentIndex, 0));
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const [menuReady, setMenuReady] = useState(false);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportPadding = 12;
    const spaceAbove = triggerRect.top - viewportPadding;
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
    const shouldOpenAbove = showLabel ? spaceAbove >= menuRect.height + 8 || spaceAbove > spaceBelow : spaceBelow < menuRect.height + 8 && spaceAbove >= menuRect.height + 8;
    const preferredTop = shouldOpenAbove ? triggerRect.top - menuRect.height - 8 : triggerRect.bottom + 8;
    const top = Math.max(viewportPadding, Math.min(preferredTop, window.innerHeight - menuRect.height - viewportPadding));
    const left = Math.max(viewportPadding, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - viewportPadding));

    setMenuPosition({ top, left });
    setMenuReady(true);
  }, [showLabel]);

  const closePicker = useCallback((restoreFocus = false) => {
    setOpen(false);
    setMenuReady(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (pickerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      closePicker();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closePicker(true);
      if (event.key === "Tab") closePicker();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePicker, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(positionMenu);
    const handleViewportChange = () => positionMenu();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, options.length, positionMenu]);

  useEffect(() => {
    if (open && menuReady) optionRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, menuReady, open]);

  useEffect(() => {
    setFocusedIndex(Math.max(options.findIndex((option) => normalizePermissionValue(option.value) === normalizePermissionValue(permissions.currentValue)), 0));
  }, [options, permissions.currentValue]);

  function openPicker(nextIndex = currentIndex >= 0 ? currentIndex : 0) {
    if (options.length === 0) return;
    setFocusedIndex(Math.max(0, Math.min(nextIndex, options.length - 1)));
    setMenuReady(false);
    setOpen(true);
  }

  function choosePermission(value: string) {
    closePicker(true);
    void onSetPermission(value);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openPicker(currentIndex >= 0 ? currentIndex : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openPicker(currentIndex >= 0 ? currentIndex : options.length - 1);
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setFocusedIndex((index) => (index + delta + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setFocusedIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[focusedIndex];
      if (option) choosePermission(option.value);
    }
  }

  const menu = open && options.length > 0 && <div
    ref={menuRef}
    id={menuId}
    className="permission-menu"
    role="listbox"
    aria-label="权限选项"
    tabIndex={-1}
    onKeyDown={handleMenuKeyDown}
    style={{ top: menuPosition.top, left: menuPosition.left, visibility: menuReady ? "visible" : "hidden" }}
  >
    {options.map((option, index) => {
      const selected = normalizePermissionValue(option.value) === normalizePermissionValue(permissions.currentValue);
      const key = permissionKey(option);
      return <button
        ref={(element) => { optionRefs.current[index] = element; }}
        className={`permission-menu-option${selected ? " selected" : ""}${key === "danger-full-access" ? " danger" : ""}`}
        type="button"
        role="option"
        aria-selected={selected}
        aria-label={`${permissionLabel(option)}：${permissionDescription(option)}`}
        tabIndex={index === focusedIndex ? 0 : -1}
        key={option.value}
        onMouseEnter={() => setFocusedIndex(index)}
        onClick={() => choosePermission(option.value)}
      >
        <span className="permission-menu-option-copy">
          <strong>{permissionLabel(option)}</strong>
          <small>{permissionDescription(option)}</small>
        </span>
        <span className="permission-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
      </button>;
    })}
  </div>;

  return <div className={`permission-picker${showLabel ? " with-label" : " surface-permission-picker"}`} ref={pickerRef}>
    {showLabel && <span className="permission-picker-caption">权限</span>}
    <button
      ref={triggerRef}
      className={`permission-picker-trigger${permissionKey(currentOption) === "danger-full-access" ? " danger" : ""}`}
      type="button"
      aria-label={`当前权限：${permissionLabel(currentOption)}`}
      aria-haspopup="listbox"
      aria-controls={open ? menuId : undefined}
      aria-expanded={open}
      title={permissionDescription(currentOption) || "选择 DSH 权限"}
      onClick={() => open ? closePicker() : openPicker()}
      onKeyDown={handleTriggerKeyDown}
    >
      <span className="permission-picker-status" aria-hidden="true" />
      <span className="permission-picker-label">{permissionLabel(currentOption)}</span>
      <span className="permission-picker-chevron" aria-hidden="true">⌄</span>
    </button>
    {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
  </div>;
}
