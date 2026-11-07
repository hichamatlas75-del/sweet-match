/**
 * @file input.js
 * @description Gestion des entrées joueur : Souris, Tactile (glisser / toucher), Clavier (Flèches + Entrée/Espace)
 * et déclenchement de l'indice automatique (hint) après 5 secondes d'inactivité.
 */

export class InputController {
  constructor(canvas, renderer, callbacks) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.callbacks = callbacks; // { onSwap(posA, posB), onCellTap(pos), canInteract(), getHint() }

    this.dragStartPos = null;  // { x, y }
    this.dragStartCell = null; // { r, c }
    this.isDragging = false;

    this.lastActivityTime = performance.now();
    this.hintDelayMs = 5000;

    this._bindEvents();
  }

  resetIdleTimer() {
    this.lastActivityTime = performance.now();
    this.renderer.hintMove = null;
  }

  update(now = performance.now()) {
    if (!this.callbacks.canInteract()) {
      this.lastActivityTime = now;
      this.renderer.hintMove = null;
      return;
    }

    if (!this.renderer.hintMove && now - this.lastActivityTime >= this.hintDelayMs) {
      const hint = this.callbacks.getHint ? this.callbacks.getHint() : null;
      if (hint) {
        this.renderer.hintMove = hint;
      }
    }
  }

  _bindEvents() {
    const getLocalCoords = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const onPointerDown = (clientX, clientY) => {
      this.resetIdleTimer();
      if (!this.callbacks.canInteract()) return;

      const coords = getLocalCoords(clientX, clientY);
      const cell = this.renderer.pixelToCell(coords.x, coords.y);
      if (!cell) return;

      this.renderer.keyboardFocusActive = false;

      // Si un booster ciblé (ex: Marteau) écoute le clic direct sur une cellule
      if (this.callbacks.onCellTap && this.callbacks.onCellTap(cell)) {
        this.renderer.selectedCell = null;
        return;
      }

      // Si une case était déjà sélectionnée et qu'on clique sur une case adjacente -> échange !
      if (this.renderer.selectedCell) {
        const prev = this.renderer.selectedCell;
        const dr = Math.abs(prev.r - cell.r);
        const dc = Math.abs(prev.c - cell.c);
        if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
          this.renderer.selectedCell = null;
          this.isDragging = false;
          this.callbacks.onSwap(prev, cell);
          return;
        }
      }

      this.renderer.selectedCell = cell;
      this.dragStartPos = coords;
      this.dragStartCell = cell;
      this.isDragging = true;
    };

    const onPointerMove = (clientX, clientY) => {
      if (!this.isDragging || !this.dragStartCell || !this.callbacks.canInteract()) return;

      const coords = getLocalCoords(clientX, clientY);
      const dx = coords.x - this.dragStartPos.x;
      const dy = coords.y - this.dragStartPos.y;
      const threshold = Math.max(16, this.renderer.cellSize * 0.32);

      if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) {
        let targetCell = null;
        if (Math.abs(dx) > Math.abs(dy)) {
          targetCell = { r: this.dragStartCell.r, c: this.dragStartCell.c + (dx > 0 ? 1 : -1) };
        } else {
          targetCell = { r: this.dragStartCell.r + (dy > 0 ? 1 : -1), c: this.dragStartCell.c };
        }

        const startCell = this.dragStartCell;
        this.isDragging = false;
        this.dragStartCell = null;
        this.renderer.selectedCell = null;

        if (
          targetCell.r >= 0 &&
          targetCell.r < this.renderer.rows &&
          targetCell.c >= 0 &&
          targetCell.c < this.renderer.cols
        ) {
          this.callbacks.onSwap(startCell, targetCell);
        }
      }
    };

    const onPointerUp = () => {
      this.isDragging = false;
      this.dragStartCell = null;
    };

    // Souris
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onPointerDown(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) onPointerMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', onPointerUp);

    // Tactile (Mobile First)
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0 && this.isDragging) {
        e.preventDefault();
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    window.addEventListener('touchend', onPointerUp);

    // Clavier (Accessibilité : Flèches + Entrée / Espace / Échap)
    window.addEventListener('keydown', (e) => {
      if (!this.callbacks.canInteract()) return;

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'];
      if (!keys.includes(e.key)) return;

      // Ne pas intercepter si un bouton de dialogue a le focus
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== this.canvas) {
        return;
      }

      e.preventDefault();
      this.resetIdleTimer();
      this.renderer.keyboardFocusActive = true;

      const cur = this.renderer.cursorCell || { r: 4, c: 4 };
      let next = { ...cur };

      if (e.key === 'ArrowUp') next.r = Math.max(0, cur.r - 1);
      else if (e.key === 'ArrowDown') next.r = Math.min(this.renderer.rows - 1, cur.r + 1);
      else if (e.key === 'ArrowLeft') next.c = Math.max(0, cur.c - 1);
      else if (e.key === 'ArrowRight') next.c = Math.min(this.renderer.cols - 1, cur.c + 1);
      else if (e.key === 'Escape') {
        this.renderer.selectedCell = null;
        return;
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (this.callbacks.onCellTap && this.callbacks.onCellTap(cur)) {
          this.renderer.selectedCell = null;
          return;
        }
        if (!this.renderer.selectedCell) {
          this.renderer.selectedCell = { ...cur };
        } else if (this.renderer.selectedCell.r === cur.r && this.renderer.selectedCell.c === cur.c) {
          this.renderer.selectedCell = null;
        } else {
          const prev = this.renderer.selectedCell;
          this.renderer.selectedCell = null;
          this.callbacks.onSwap(prev, cur);
        }
        return;
      }

      // Si une case est déjà sélectionnée et qu'on appuie sur une flèche, cela échange directement !
      if (this.renderer.selectedCell && (next.r !== cur.r || next.c !== cur.c)) {
        const from = this.renderer.selectedCell;
        this.renderer.selectedCell = null;
        this.renderer.cursorCell = next;
        this.callbacks.onSwap(from, next);
      } else {
        this.renderer.cursorCell = next;
      }
    });
  }
}
