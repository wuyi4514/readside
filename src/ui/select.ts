export interface SelectOption { value: string; label: string; detail?: string; disabled?: boolean }
interface SelectConfig { label: string; multiple?: boolean; onChange(values: string[]): Promise<void> }
let sequence = 0;

/** Shared keyboard-accessible listbox. A popover keeps the menu clear of card clipping. */
export class ProductSelect {
  private trigger = document.createElement('button');
  private panel = document.createElement('div');
  private summary = document.createElement('span');
  private options: SelectOption[] = [];
  private values: string[] = [];
  private active = 0;
  private open = false;
  private pending = false;
  constructor(private host: HTMLElement, private config: SelectConfig) {
    const id = `readside-select-${++sequence}`;
    this.trigger.type = 'button'; this.trigger.className = 'select-trigger'; this.trigger.id = `${id}-trigger`;
    this.trigger.setAttribute('role', 'combobox'); this.trigger.setAttribute('aria-label', config.label);
    this.trigger.setAttribute('aria-haspopup', 'listbox'); this.trigger.setAttribute('aria-controls', id); this.trigger.setAttribute('aria-expanded', 'false');
    this.summary.className = 'select-value';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 16 16'); chevron.setAttribute('aria-hidden', 'true'); chevron.classList.add('select-chevron');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm4 6 4 4 4-4'); chevron.append(path);
    this.trigger.append(this.summary, chevron);
    this.panel.id = id; this.panel.className = 'select-menu'; this.panel.popover = 'manual'; this.panel.setAttribute('role', 'listbox'); this.panel.setAttribute('aria-label', config.label);
    if (config.multiple) this.panel.setAttribute('aria-multiselectable', 'true');
    this.host.replaceChildren(this.trigger, this.panel);
    this.trigger.addEventListener('click', () => this.open ? this.close() : this.show());
    this.trigger.addEventListener('keydown', event => this.key(event));
    document.addEventListener('pointerdown', event => { if (!this.host.contains(event.target as Node)) this.close(); });
    window.addEventListener('resize', () => this.close());
    window.addEventListener('blur', () => this.close());
  }
  setOptions(options: SelectOption[]): void { this.options = options; this.render(); }
  setValues(values: string[]): void { this.values = [...values]; this.render(); }
  private render(): void {
    const labels = this.options.filter(o => this.values.includes(o.value)).map(o => o.label);
    this.summary.textContent = labels.join('、') || '请选择'; this.trigger.title = labels.join('、');
    this.panel.replaceChildren(...this.options.map((option, index) => {
      const row = document.createElement('div'); row.className = 'select-option'; row.id = `${this.panel.id}-${index}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(this.values.includes(option.value)));
      row.setAttribute('aria-disabled', String(!!option.disabled || (this.config.multiple && this.values.length === 1 && this.values[0] === option.value)));
      const check = document.createElement('span'); check.className = this.config.multiple ? 'option-check' : 'option-tick'; check.setAttribute('aria-hidden', 'true');
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); mark.setAttribute('viewBox', '0 0 16 16');
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tick.setAttribute('d', 'm4 8 2.5 2.5L12 5.5'); mark.append(tick); check.append(mark);
      const label = document.createElement('span'); label.className = 'option-label'; label.textContent = option.label;
      if (option.detail) { const detail = document.createElement('small'); detail.textContent = option.detail; label.append(detail); }
      row.append(label, check);
      row.addEventListener('pointermove', () => { this.active = index; this.highlight(); });
      row.addEventListener('pointerdown', event => event.preventDefault()); // Keep focus on combobox.
      row.addEventListener('click', () => { this.active = index; void this.choose(); }); return row;
    }));
    this.highlight();
    if (this.open) this.position();
  }
  private show(): void {
    if (this.pending || !this.options.length) return;
    this.active = Math.max(0, this.options.findIndex(o => this.values.includes(o.value)));
    this.panel.showPopover(); this.open = true; this.trigger.setAttribute('aria-expanded', 'true'); this.highlight(); this.position();
  }
  private close(): void {
    if (!this.open) return;
    this.panel.hidePopover(); this.open = false; this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.removeAttribute('aria-activedescendant');
  }
  private highlight(): void {
    [...this.panel.children].forEach((row, index) => row.classList.toggle('active', index === this.active));
    if (this.open) {
      this.trigger.setAttribute('aria-activedescendant', `${this.panel.id}-${this.active}`);
      this.panel.children[this.active]?.scrollIntoView({ block: 'nearest' });
    }
  }
  private position(): void {
    const rect = this.trigger.getBoundingClientRect(); const gap = 6;
    const below = innerHeight - rect.bottom - 10; const above = rect.top - 10;
    const upwards = below < 220 && above > below;
    this.panel.style.width = `${rect.width}px`;
    this.panel.style.maxHeight = `${Math.min(304, Math.max(80, upwards ? above : below))}px`;
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.top = upwards ? `${Math.max(6, rect.top - this.panel.offsetHeight - gap)}px` : `${rect.bottom + gap}px`;
  }
  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') { if (this.open) { event.preventDefault(); this.close(); } return; }
    if (event.key === 'Tab') { this.close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!this.open) { this.show(); return; }
    if (event.key === 'Enter' || event.key === ' ') { void this.choose(); return; }
    this.active = event.key === 'Home' ? 0 : event.key === 'End' ? this.options.length - 1 : (this.active + (event.key === 'ArrowUp' ? -1 : 1) + this.options.length) % this.options.length;
    this.highlight();
  }
  private async choose(): Promise<void> {
    const option = this.options[this.active]; if (!option || this.pending) return;
    const selected = this.values.includes(option.value);
    if (option.disabled && !selected) return;
    if (this.config.multiple && selected && this.values.length === 1) return;
    const previous = this.values;
    const next = this.config.multiple ? this.options.filter(o => o.value === option.value ? !selected : this.values.includes(o.value)).map(o => o.value) : [option.value];
    this.values = next; this.render(); if (!this.config.multiple) this.close();
    this.pending = true; this.trigger.setAttribute('aria-busy', 'true');
    try { await this.config.onChange(next); }
    catch { this.values = previous; this.render(); }
    finally { this.pending = false; this.trigger.removeAttribute('aria-busy'); }
  }
}
