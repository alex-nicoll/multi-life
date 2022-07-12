// This script should be run after the HTML document has been loaded and
// parsed. It adds additional elements to the document, sets up event handlers,
// and sets up the WebSocket connection.
//
// You will see a few statements like this:
//   const x = (() => {...})();
// There will be some variables inside the ..., and some functions returned and
// assigned to x. The purpose is to keep the variables together with the
// functions that use them. The functions are accessible in the parent scope,
// but the variables are not. This is sometimes called the Revealing Module
// Pattern (RMP).
//
// Similarly, you will see statements like this:
//   {...}
// The variables inside the ... are kept out of the parent scope. See
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/block
//
// There are also statments like this:
//   element.style.x = "something";
// This creates an inline style declaration for property x, overriding the
// style declared in CSS. Setting x to "" removes the inline style declaration,
// no longer overriding the style declared in CSS. See
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style

const iconButtons = document.getElementsByClassName("icon_button");

// Allow icon buttons to change state when touched or moused over.
for (let i = 0; i < iconButtons.length; i++) {
  const ib = iconButtons.item(i);
  ib.addEventListener("pointerenter", (e) => {
    ib.classList.add("icon_button_over");
  });
  ib.addEventListener("pointerleave", (e) => {
    ib.classList.remove("icon_button_over");
  });
}

// Allow the modal to be opened and closed.
{
  const modal = document.getElementById("modal_container");
  iconButtons.namedItem("info").addEventListener("click", (e) => {
    modal.style.visibility = "";
  });
  iconButtons.namedItem("close").addEventListener("click", (e) => {
    modal.style.visibility = "hidden";
  });
}

// Allow inputting the species (a seven-character hexadecimal color code).
// Start with a random species.
{
  let species = "#" +
    Math.floor(Math.random() * Math.pow(2,24)).toString(16).padStart(6, "0");
  const speciesInput = document.getElementById("species");
  speciesInput.value = species;
  speciesInput.addEventListener("input", (e) => {
    species = e.target.value;
  });
}

const overlay_cells = document.getElementById("overlay_cells");

// Create the board cells and overlay cells.
{
  const board = document.getElementById("board");
  board.appendChild(makeCells((cell, x, y) => {
    cell.id = `${x},${y}`
    cell.className = "board_cell_empty";
  }));

  overlay_cells.appendChild(makeCells((cell, x, y) => {
    cell.id = `${x},${y}-overlay`
  }));

  function makeCells(callback) {
    const frag = document.createDocumentFragment();
    for (let x = 0; x < 120; x++) {
      for (let y = 0; y < 120; y++) {
        const cell = document.createElement("div");
        // CSS Grid rows and columns are indexed at 1, as opposed to 0.
        cell.style.gridRow = `${x+1}`;
        cell.style.gridColumn = `${y+1}`;
        callback(cell, x, y);
        frag.appendChild(cell);
      }
    }
    return frag;
  }
}

// Prevent dragging of overlay cells.
overlay_cells.addEventListener("dragstart", (e) => {
  e.preventDefault();
});

const view = document.getElementById("view");

// Prevent the view from scrolling when the mouse is pressed down inside the
// view and then dragged to the edge of the view.
{
  let isDraggingView = false;
  view.addEventListener("mousedown", (e) => {
    isDraggingView = true;
  });
  view.addEventListener("mousemove", (e) => {
    e.preventDefault();
  });
  document.addEventListener("mouseup", (e) => {
    isDraggingView = false;
  });
};

// Object editor supports filling, emptying, and flushing the overlay cells
// (div elements). Flushing means emptying all of the filled overlay cells and
// converting them to a diff to submit to the server.
const editor = (() => {

  // Map where the key is an overlay cell that has been filled, and the value
  // is the species used to fill that cell.
  const filledOverlayCells = new Map();

  function fill(cell) {
    cell.className = "overlay_cell_filled";
    cell.style.backgroundColor = species;
    // Store the species along with the cell, to be sent to the server later. We
    // won't be able to use the value of style.backgroundColor, because it may be
    // converted from hexadecimal to something else (e.g., an RGB string),
    // whereas the server accepts only hexadecimal strings.
    filledOverlayCells.set(cell, species);
  }

  function empty(cell) {
    cell.className = "";
    cell.style.backgroundColor = "";
    filledOverlayCells.delete(cell);
  }

  function flush() {
    if (filledOverlayCells.size === 0) {
      return;
    }
    const diff = {};
    filledOverlayCells.forEach((species, cell) => {
      const x_ysuffix = cell.id.split(",");
      const x = x_ysuffix[0];
      const y = x_ysuffix[1].split("-overlay")[0];
      if (diff[x] === undefined) {
        diff[x] = {};
      }
      diff[x][y] = species;

      empty(cell);
    });
    return diff;
  }

  return { fill, empty, flush };
})();

{
  // Object mouseDraw allows drawing and erasing by clicking or dragging with a
  // mouse.
  const mouseDraw = (() => {
    // drawState is either "drawing", "erasing", or undefined.
    let drawState;

    function handleMouseDown(e) {
      const cell = e.target;
      if (cell.className === "overlay_cell_filled") {
        editor.empty(cell);
        drawState = "erasing";
      } else {
        editor.fill(cell);
        drawState = "drawing";
      }
    }

    function handleMouseOver(e) {
      drawOrErase(drawState, e.target);
    }

    function handleMouseUp(e) {
      drawState = undefined;
    }

    return {
      enable: () => {
        overlay_cells.addEventListener("mousedown", handleMouseDown);
        overlay_cells.addEventListener("mouseover", handleMouseOver);
        document.addEventListener("mouseup", handleMouseUp);
      },
      disable: () => {
        overlay_cells.removeEventListener("mousedown", handleMouseDown);
        overlay_cells.removeEventListener("mouseover", handleMouseOver);
        document.removeEventListener("mouseup", handleMouseUp);
        drawState = undefined;
      }
    };
  })();

  // Object touchDraw allows drawing and erasing by dragging with a single touch.
  // touchDraw only draws when a single touch moves. It doesn't draw when a
  // single touch starts, in order to prevent accidental drawing in case of a
  // multi-touch pan/zoom. As a result, we need some other way to handle taps.
  const touchDraw = (() => {
    // drawState is either "drawing", "erasing", or undefined.
    let drawState;

    function handleTouchStart(e) {
      if (e.touches.length !== 1) {
        return;
      }
      if (e.target.className === "overlay_cell_filled") {
        drawState = "erasing";
      } else {
        drawState = "drawing";
      }
    }

    function handleTouchMove(e) {
      if (e.touches.length !== 1) {
        return;
      }
      if (e.cancelable) {
        // Prevent scrolling.
        e.preventDefault();
      }
      const touch = e.touches.item(0);
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) {
        // Touch moved outside of the viewport.
        return;
      }
      if (!el.id.endsWith("-overlay")) {
        // Touch moved outside of overlay_cells.
        return;
      }
      drawOrErase(drawState, el);
    }

    function handleTouchEnd(e) {
      drawState = undefined;
    }

    function handleTouchCancel(e) {
      drawState = undefined;
    }

    return {
      enable: () => {
        overlay_cells.addEventListener("touchstart", handleTouchStart);
        overlay_cells.addEventListener("touchmove", handleTouchMove);
        document.addEventListener("touchend", handleTouchEnd);
        document.addEventListener("touchcancel", handleTouchCancel);
      },
      disable: () => {
        overlay_cells.removeEventListener("touchstart", handleTouchStart);
        overlay_cells.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
        document.removeEventListener("touchcancel", handleTouchCancel);
        drawState = undefined;
      }
    };
  })();

  // Object tapDraw allows drawing and erasing by tapping with a single touch.
  // You might ask, why is this object needed at all? The browser already fires
  // mousedown when a tap ("click") is detected, so mouseDraw should handle taps.
  // Well, on Safari for iOS and DuckDuckGo for Android, waiting for the
  // mousedown event leads to a very obvious delay between tap and response.
  const tapDraw = (() => {
    let isTapping = false;

    function handleTouchStart(e) {
      if (e.touches.length !== 1) {
        // Cancel the tap when multiple touches are detected.
        isTapping = false;
      }
      isTapping = true;
    }

    function handleTouchMove(e) {
      isTapping = false;
    }

    function handleTouchEnd(e) {
      if (e.touches.length !== 0) {
        // There are still touches on the touch surface, so this isn't a tap.
        isTapping = false;
        return;
      }
      if (!isTapping) {
        // This is the end of a one-touch movement, or a multi-touch interaction.
        return;
      }
      const cell = e.target;
      if (cell.className === "overlay_cell_filled") {
        editor.empty(cell);
      } else {
        editor.fill(cell);
      }
      isTapping = false;
      // Prevent further events from firing, including mousedown (and mouseup,
      // and click). If mousedown were to fire with mouseDraw enabled, then we
      // would erase the cell that was just drawn.
      e.preventDefault();
    }

    function handleTouchCancel(e) {
      isTapping = false;
    }

    return {
      enable: () => {
        overlay_cells.addEventListener("touchstart", handleTouchStart);
        overlay_cells.addEventListener("touchmove", handleTouchMove);
        overlay_cells.addEventListener("touchend", handleTouchEnd);
        overlay_cells.addEventListener("touchcancel", handleTouchCancel);
      },
      disable: () => {
        overlay_cells.removeEventListener("touchstart", handleTouchStart);
        overlay_cells.removeEventListener("touchmove", handleTouchMove);
        overlay_cells.removeEventListener("touchend", handleTouchEnd);
        overlay_cells.removeEventListener("touchcancel", handleTouchCancel);
        isTapping = false;
      }
    };
  })();

  // Object mousePan allows panning by dragging with a mouse.
  const mousePan = (() => {
    let isPanning = false;

    function handleMouseDown(e) {
      isPanning = true;
    }

    function handleMouseMove(e) {
      if (isPanning) {
        view.scrollTop -= e.movementY;
        view.scrollLeft -= e.movementX;
      }
    }

    function handleMouseUp(e) {
      isPanning = false;
    }

    return {
      enable: () => {
        view.addEventListener("mousedown", handleMouseDown);
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      },
      disable: () => {
        view.removeEventListener("mousedown", handleMouseDown);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        isPanning = false;
      }
    };
  })();

  // isPanMode is true when we are in pan mode, and false when we are in
  // draw/erase mode.
  let isPanMode = false;
  mouseDraw.enable();
  touchDraw.enable();
  tapDraw.enable();

  // Allow switching between pan mode and draw/erase mode.
  const move = iconButtons.namedItem("move");
  move.addEventListener("click", (e) => {
    if (isPanMode) {
      isPanMode = false;
      mousePan.disable();

      mouseDraw.enable();
      touchDraw.enable();
      tapDraw.enable();

      move.style.borderColor = "";

    } else {
      isPanMode = true;
      mousePan.enable();

      mouseDraw.disable();
      touchDraw.disable();
      tapDraw.disable();

      move.style.borderColor = "unset";
    }
  });

  function drawOrErase(drawState, cell) {
    if (drawState === "drawing" && cell.className === "") {
      editor.fill(cell);
    } else if (drawState === "erasing" && cell.className === "overlay_cell_filled") {
      editor.empty(cell);
    }
  }
}

{
  // buffer contains the enqueued diffs from the server.
  let buffer = [];

  // Object ws supports connecting and disconnecting from the WebSocket server,
  // and submitting the diff represented by the filled overlay cells to the
  // server.
  const ws = (() => {
    let websocket;

    function connect() {
      websocket = new WebSocket(`ws:\/\/${document.location.host}`);
      websocket.addEventListener("message", bufferProcessor.enqueue);
    }

    function disconnect(reason) {
      websocket.close(1000, reason);
      buffer = [];
    }

    function submit() {
      websocket.send(JSON.stringify(editor.flush()));
    }

    return { connect, disconnect, submit };
  })();

  // Object bufferProcessor treats buffer as a FIFO queue of incoming board
  // diffs. Function enqueue takes a WebSocket message and adds the diff
  // contained within to buffer. Diffs are dequeued, parsed, and applied to the
  // board at a regular interval.
  //
  // When the empty diff ("{}") is dequeued, signaling the end of a stream,
  // dequeueing stops. When a new stream begins, dequeueing starts up again.
  //
  // The buffer is considered to be overflowing when it has greater than 5
  // elements. bufferProcessor periodically checks for overflow, and resets the
  // connection when this is the case.
  //
  // As a special case, enqueue handles the grid message (the first message on a
  // connection) by applying it to the board immediately. This is because the
  // server sends the grid immediately. Waiting to process it on the next "tick",
  // as if it were a diff, would incur a slight delay.
  //
  // See protocol.md for more information.
  const bufferProcessor = (() => {

    const dequeueInterval = 170;
    let dequeueIntervalID;
    const timeBetweenBalances = 8000;
    let balanceBufferTimeoutID;
    let isBufferOverflowing = false;

    function start() {
      balanceBufferTimeoutID = setTimeout(balanceBuffer, timeBetweenBalances);
    }

    function stop() {
      if (dequeueIntervalID !== undefined) {
        clearInterval(dequeueIntervalID);
        dequeueIntervalID = undefined;
      }
      clearTimeout(balanceBufferTimeoutID);
      balanceBufferTimeoutID = undefined;
    }

    function balanceBuffer() {
      if (isBufferOverflowing) {
        ws.disconnect("buffer overflow");
        ws.connect();
      }
      balanceBufferTimeoutID = setTimeout(balanceBuffer, timeBetweenBalances);
    }

    function enqueue(message) {
      message.data.text().then((json) => {
        if (dequeueIntervalID === undefined) {
          dequeueIntervalID = setInterval(dequeue, dequeueInterval);
        }
        if (json.startsWith("[")) {
          // Apply the grid message to the board immediately.
          update(json);
          return;
        }
        buffer.push(json);
        checkForBufferOverflow();
      });
    }

    function dequeue() {
      if (buffer.length === 0) {
        return;
      }
      const json = buffer.shift();
      checkForBufferOverflow();
      if (json === "{}" && buffer.length === 0) {
        // We've reached the end of the current stream and there are no further
        // diffs, so we can stop dequeueing. enqueue will start us dequeuing
        // again when appropriate.
        clearInterval(dequeueIntervalID);
        dequeueIntervalID = undefined;
        return;
      }
      update(json);
    }

    // update applies a grid or diff to the board.
    function update(json) {
      const change = JSON.parse(json);
      for (const x in change) {
        for (const y in change[x]) {
          const cell = document.getElementById(`${x},${y}`);
          const species = change[x][y];
          if (species !== "") {
            cell.className = "board_cell_filled";
            cell.style.backgroundColor = species;
          } else {
            cell.className = "board_cell_empty";
            cell.style.backgroundColor = "";
          }
        }
      }
    }

    function checkForBufferOverflow() {
      isBufferOverflowing = buffer.length >= 6;
    }

    return { start, stop, enqueue }
  })();

  bufferProcessor.start();
  // Connect to the WebSocket server.
  // Use setTimeout to ensure that all the costly DOM updates in this script
  // complete before we start enqueuing messages.
  setTimeout(ws.connect, 0);

  // Release resources when the page is hidden, and reallocate them when the page
  // becomes visible again.
  // We may get a visibilitychange event with visibilityState "visible" without
  // a corresponding "hidden" event. This was observed to happen on Safari for
  // iOS when minimizing the browser and then quickly maximizing it. So we use
  // isPageHidden to determine whether the visibility state actually changed from
  // "hidden" to "visible", thereby preventing a resource leak.
  {
    let isPageHidden = false;
    document.addEventListener("visibilitychange", (e) => {
      if (document.visibilityState === "hidden") {
        bufferProcessor.stop();
        ws.disconnect("page hidden");
        isPageHidden = true;
      } else if (document.visibilityState === "visible") {
        if (isPageHidden) {
          bufferProcessor.start();
          ws.connect();
          isPageHidden = false;
        }
      }
    });
  }

  // Allow submitting via the Enter key.
  document.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      ws.submit();
    }
  });

  // Allow submitting via the submit button.
  iconButtons.namedItem("submit").addEventListener("click", ws.submit);
}
