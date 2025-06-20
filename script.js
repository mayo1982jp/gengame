window.requestAnimationFrame(() => {
  new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
});

function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size = size; // Size of the grid
  this.inputManager = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator = new Actuator;

  this.startTiles = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Keep playing after winning (allows players to continue to chase a higher score)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has been won and the user hasn't chosen to keep playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  if (previousState) {
    this.grid = new Grid(previousState.grid.size, previousState.grid.cells); // Reload grid
    this.score = previousState.score;
    this.over = previousState.over;
    this.won = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
  } else {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score: this.score,
    over: this.over,
    won: this.won,
    bestScore: this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });
};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    keepPlaying: this.keepPlaying
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;

          // The mighty 2048 tile
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0, y: -1 }, // Up
    1: { x: 1, y: 0 },  // Right
    2: { x: 0, y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
    this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is possible
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell = { x: x + vector.x, y: y + vector.y };

          var other = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

//Grid constructor
function Grid(size, previousState) {
  this.size = size;
  this.cells = previousState ? this.fromState(previousState) : this.empty();
}

// Build a grid of the specified size
Grid.prototype.empty = function () {
  var cells = [];

  for (var x = 0; x < this.size; x++) {
    var row = cells[x] = [];

    for (var y = 0; y < this.size; y++) {
      row.push(null);
    }
  }

  return cells;
};

Grid.prototype.fromState = function (state) {
  var cells = [];

  for (var x = 0; x < this.size; x++) {
    var row = cells[x] = [];

    for (var y = 0; y < this.size; y++) {
      var tile = state[x][y];
      row.push(tile ? new Tile(tile.position, tile.value) : null);
    }
  }

  return cells;
};

// Find the first available random position
Grid.prototype.randomAvailableCell = function () {
  var cells = this.availableCells();

  if (cells.length) {
    return cells[Math.floor(Math.random() * cells.length)];
  }
};

Grid.prototype.availableCells = function () {
  var cells = [];

  this.eachCell(function (x, y, tile) {
    if (!tile) {
      cells.push({ x: x, y: y });
    }
  });

  return cells;
};

// Call callback for every cell
Grid.prototype.eachCell = function (callback) {
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      callback(x, y, this.cells[x][y]);
    }
  }
};

// Check if there are any cells available
Grid.prototype.cellsAvailable = function () {
  return !!this.availableCells().length;
};

// Check if the specified cell is taken
Grid.prototype.cellAvailable = function (cell) {
  return !this.cellOccupied(cell);
};

Grid.prototype.cellOccupied = function (cell) {
  return !!this.cellContent(cell);
};

Grid.prototype.cellContent = function (cell) {
  if (this.withinBounds(cell)) {
    return this.cells[cell.x][cell.y];
  } else {
    return null;
  }
};

// Inserts a tile at its position
Grid.prototype.insertTile = function (tile) {
  this.cells[tile.x][tile.y] = tile;
};

Grid.prototype.removeTile = function (tile) {
  this.cells[tile.x][tile.y] = null;
};

Grid.prototype.withinBounds = function (position) {
  return position.x >= 0 && position.x < this.size &&
    position.y >= 0 && position.y < this.size;
};

Grid.prototype.serialize = function () {
  var cellState = [];

  for (var x = 0; x < this.size; x++) {
    var row = cellState[x] = [];

    for (var y = 0; y < this.size; y++) {
      row.push(this.cells[x][y] ? this.cells[x][y].serialize() : null);
    }
  }

  return {
    size: this.size,
    cells: cellState
  };
};

//Tile constructor
function Tile(position, value) {
  this.x = position.x;
  this.y = position.y;
  this.value = value || 2;

  this.previousPosition = null;
  this.mergedFrom = null; // Tracks tiles that merged together
}

Tile.prototype.savePosition = function () {
  this.previousPosition = { x: this.x, y: this.y };
};

Tile.prototype.updatePosition = function (position) {
  this.x = position.x;
  this.y = position.y;
};

Tile.prototype.serialize = function () {
  return {
    position: {
      x: this.x,
      y: this.y
    },
    value: this.value
  };
};

//HTML Actuator
function HTMLActuator() {
  this.tileContainer = document.querySelector(".tile-container");
  this.scoreContainer = document.querySelector(".score-container");
  this.bestContainer = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.gridContainer = document.querySelector('.grid-container'); // Added this line
  this.score = 0;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;

  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell);
        }
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    if (metadata.terminated) {
      if (metadata.over) {
        self.message(false); // You lose
      } else if (metadata.won) {
        self.message(true); // You win!
      }
    }

  });
};

// Continues the game (both restart and keep playing)
HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;

  var wrapper = document.createElement("div");
  var inner = document.createElement("div"); // This is the element that will show the number

  // Calculate tile size and position dynamically
  var containerWidth = this.tileContainer.offsetWidth;
  var gapStyle = window.getComputedStyle(this.gridContainer).gap;
  var gap = parseFloat(gapStyle) || 15; // Fallback if gap is not found or not a number

  var gridSize = this.grid ? this.grid.size : 4; // Use grid size from game if available, else default to 4

  var tileSize = (containerWidth - gap * (gridSize + 1)) / gridSize;

  if (tileSize <= 0) {
      var gridCellElement = document.querySelector('.grid-container .grid-cell');
      if (gridCellElement) {
          tileSize = gridCellElement.offsetWidth;
      } else {
           tileSize = 50;
      }
  }

  wrapper.style.width = tileSize + "px";
  wrapper.style.height = tileSize + "px";

  var currentPos = tile.previousPosition || { x: tile.x, y: tile.y };
  wrapper.style.left = (currentPos.x * (tileSize + gap) + gap) + "px";
  wrapper.style.top = (currentPos.y * (tileSize + gap) + gap) + "px";

  var classes = ["tile", "tile-" + tile.value];
  if (tile.value > 2048) classes.push("tile-super");

  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;
  wrapper.appendChild(inner);

  this.tileContainer.appendChild(wrapper);

  if (tile.previousPosition) {
      window.requestAnimationFrame(function () {
          wrapper.style.left = (tile.x * (tileSize + gap) + gap) + "px";
          wrapper.style.top = (tile.y * (tileSize + gap) + gap) + "px";
      });
  }

  if (!tile.previousPosition && !tile.mergedFrom) {
      wrapper.classList.add("tile-new");
  }

  if (tile.mergedFrom) {
      wrapper.classList.add("tile-merged");
      tile.mergedFrom.forEach(function (merged) {
          var tempMergedTile = new Tile(merged.previousPosition || merged.position, merged.value);
          self.addTile(tempMergedTile);
      });
  }
};

HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

HTMLActuator.prototype.normalizePosition = function (position) {
  return { x: position.x + 1, y: position.y + 1 };
};

HTMLActuator.prototype.positionClass = function (position) {
  // This method is less critical if direct styling of left/top is used.
  // Kept for potential compatibility or future use.
  position = this.normalizePosition(position); // To 1-based
  return "tile-position-" + position.x + "-" + position.y;
};


HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);

  var difference = score - this.score;
  this.score = score;

  this.scoreContainer.textContent = this.score;

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;
    // Note: CSS for .score-addition needs to be defined for this to be visible.
    // Example: .score-addition { position: absolute; right: 0; top: -20px; animation: move-up 0.5s ease-out; }
    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  this.bestContainer.textContent = bestScore;
};

HTMLActuator.prototype.message = function (won) {
  var type = won ? "game-won" : "game-over";
  var messageText = won ? "You win!" : "Game over!";

  if (document.documentElement.lang === "ja") {
    messageText = won ? "クリア！" : "ゲームオーバー";
  }

  this.messageContainer.classList.add(type);
  this.messageContainer.getElementsByTagName("p")[0].textContent = messageText;
  this.messageContainer.style.display = "flex";
};

HTMLActuator.prototype.clearMessage = function () {
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
  this.messageContainer.style.display = "none";
};


//Keyboard Input Manager
function KeyboardInputManager() {
  this.events = {};

  if (window.navigator.msPointerEnabled) {
    this.eventTouchstart = "MSPointerDown";
    this.eventTouchmove = "MSPointerMove";
    this.eventTouchend = "MSPointerUp";
  } else {
    this.eventTouchstart = "touchstart";
    this.eventTouchmove = "touchmove";
    this.eventTouchend = "touchend";
  }

  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) {
    this.events[event] = [];
  }
  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event];
  if (callbacks) {
    callbacks.forEach(function (callback) {
      callback(data);
    });
  }
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;

  var map = {
    38: 0, // Up
    39: 1, // Right
    40: 2, // Down
    37: 3, // Left
    75: 0, // Vim k
    76: 1, // Vim l
    74: 2, // Vim j
    72: 3, // Vim h
    87: 0, // W
    68: 1, // D
    83: 2, // S
    65: 3  // A
  };

  document.addEventListener("keydown", function (event) {
    var modifiers = event.altKey || event.ctrlKey || event.metaKey ||
      event.shiftKey;
    var mapped = map[event.which];

    if (!modifiers) {
      if (mapped !== undefined) {
        event.preventDefault();
        self.emit("move", mapped);
      }
    }

    if (!modifiers && event.which === 82) { // R key
      self.restart.call(self, event);
    }
  });

  this.bindButtonPress(".retry-button", this.restart);
  this.bindButtonPress(".restart-button", this.restart);
  // Assuming a .keep-playing-button might exist or be added later for the "Keep Playing" feature.
  // If not, this won't cause an error due to the check in bindButtonPress.
  var keepPlayingButton = document.querySelector('.keep-playing-button');
  if (keepPlayingButton) { // Only bind if the button exists in HTML
      this.bindButtonPress(".keep-playing-button", this.keepPlaying);
  }


  var touchStartClientX, touchStartClientY;
  var gameContainer = document.querySelector(".game-container"); // Changed from getElementsByClassName

  gameContainer.addEventListener(this.eventTouchstart, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 1) ||
      (window.navigator.msPointerEnabled && !event.isPrimary)) { // Check for primary pointer in IE10
      return;
    }

    if (window.navigator.msPointerEnabled) {
      touchStartClientX = event.pageX;
      touchStartClientY = event.pageY;
    } else {
      touchStartClientX = event.touches[0].clientX;
      touchStartClientY = event.touches[0].clientY;
    }
    // No event.preventDefault() here to allow page scrolling if swipe not on game-container.
    // However, game-container has touch-action: none in CSS.
  });

  gameContainer.addEventListener(this.eventTouchmove, function (event) {
    // event.preventDefault(); // Prevent scrolling when dragging on game container. Handled by touch-action in CSS.
  });

  gameContainer.addEventListener(this.eventTouchend, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 0) || // Still touching with other fingers
        (window.navigator.msPointerEnabled && !event.isPrimary)) {
        return;
    }

    var touchEndClientX, touchEndClientY;

    if (window.navigator.msPointerEnabled) {
      touchEndClientX = event.pageX;
      touchEndClientY = event.pageY;
    } else {
      touchEndClientX = event.changedTouches[0].clientX;
      touchEndClientY = event.changedTouches[0].clientY;
    }

    var dx = touchEndClientX - touchStartClientX;
    var absDx = Math.abs(dx);

    var dy = touchEndClientY - touchStartClientY;
    var absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > 10) { // Swipe detected
      self.emit("move", absDx > absDy ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    }
  });
};

KeyboardInputManager.prototype.restart = function (event) {
  event.preventDefault();
  this.emit("restart");
};

KeyboardInputManager.prototype.keepPlaying = function (event) {
  event.preventDefault();
  this.emit("keepPlaying");
};

KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var button = document.querySelector(selector);
  if (button) {
    button.addEventListener("click", fn.bind(this));
    // Adding touchend for mobile responsiveness, prevent double tap issues if any.
    button.addEventListener(this.eventTouchend, function(event) {
        event.preventDefault(); // Prevent click from firing again if it's already handled.
        fn.call(this, event); // Call the original function.
    }.bind(this));
  }
};


//Local Storage Manager
function LocalStorageManager() {
  this.bestScoreKey = "bestScore";
  this.gameStateKey = "gameState";
  this.storage = this.localStorageSupported() ? window.localStorage : this.getFakeStorage();
}

LocalStorageManager.prototype.localStorageSupported = function () {
  var testKey = "test";
  try {
    var storage = window.localStorage;
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
};

LocalStorageManager.prototype.getFakeStorage = function () {
  // Basic fake storage for environments where localStorage is not available
  var fakeStorage = {};
  return {
    getItem: function (key) {
      return fakeStorage[key] || null;
    },
    setItem: function (key, value) {
      fakeStorage[key] = value.toString();
    },
    removeItem: function (key) {
      delete fakeStorage[key];
    }
  };
};


// Best score getters/setters
LocalStorageManager.prototype.getBestScore = function () {
  return parseInt(this.storage.getItem(this.bestScoreKey), 10) || 0;
};

LocalStorageManager.prototype.setBestScore = function (score) {
  this.storage.setItem(this.bestScoreKey, score);
};

// Game state getters/setters
LocalStorageManager.prototype.getGameState = function () {
  var stateJSON = this.storage.getItem(this.gameStateKey);
  return stateJSON ? JSON.parse(stateJSON) : null;
};

LocalStorageManager.prototype.setGameState = function (gameState) {
  this.storage.setItem(this.gameStateKey, JSON.stringify(gameState));
};

LocalStorageManager.prototype.clearGameState = function () {
  this.storage.removeItem(this.gameStateKey);
};

// Polyfill for window.requestAnimationFrame
(function() {
    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame']
                                   || window[vendors[x]+'CancelRequestAnimationFrame'];
    }

    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function(callback, element) {
            var currTime = new Date().getTime();
            var timeToCall = Math.max(0, 16 - (currTime - lastTime)); // Aim for 60 FPS
            var id = window.setTimeout(function() { callback(currTime + timeToCall); },
              timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };

    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
}());

// Ensure the script runs after the DOM is fully loaded
// The initial call is already wrapped in requestAnimationFrame,
// but DOM elements are selected in constructors.
// It's common to wrap object instantiations in DOMContentLoaded listener.
// However, the original script places script tag at the end of body,
// so DOM elements are available. The requestAnimationFrame wrapper is fine.

// Minor correction in HTMLActuator's addTile for merged tiles animation:
// Ensure previousPosition is used for mergedFrom tiles if available,
// otherwise their base position.
HTMLActuator.prototype.addTile = function (tile) {
    var self = this;

    var wrapper = document.createElement("div");
    var inner = document.createElement("div");

    var containerWidth = this.tileContainer.offsetWidth;
    var gapStyle = window.getComputedStyle(this.gridContainer).gap;
    var gap = parseFloat(gapStyle) || 15;

    var gridSize = this.grid && this.grid.size ? this.grid.size : 4;

    var tileSize = (containerWidth - gap * (gridSize + 1)) / gridSize;

    if (tileSize <= 0) {
        var gridCellElement = this.gridContainer.querySelector('.grid-cell'); // Use pre-fetched gridContainer
        if (gridCellElement) {
            tileSize = gridCellElement.offsetWidth;
        } else {
             tileSize = 50;
        }
    }

    wrapper.style.width = tileSize + "px";
    wrapper.style.height = tileSize + "px";

    var currentPos = tile.previousPosition || { x: tile.x, y: tile.y };
    wrapper.style.left = (currentPos.x * (tileSize + gap) + gap) + "px";
    wrapper.style.top = (currentPos.y * (tileSize + gap) + gap) + "px";

    var classes = ["tile", "tile-" + tile.value];
    if (tile.value > 2048) classes.push("tile-super");

    this.applyClasses(wrapper, classes);

    inner.classList.add("tile-inner");
    inner.textContent = tile.value;
    wrapper.appendChild(inner);

    this.tileContainer.appendChild(wrapper);

    if (tile.previousPosition && (tile.previousPosition.x !== tile.x || tile.previousPosition.y !== tile.y)) {
        window.requestAnimationFrame(function () {
            wrapper.style.left = (tile.x * (tileSize + gap) + gap) + "px";
            wrapper.style.top = (tile.y * (tileSize + gap) + gap) + "px";
        });
    }


    if (!tile.previousPosition && !tile.mergedFrom) { // A new tile
        wrapper.classList.add("tile-new");
    }

    if (tile.mergedFrom) { // A merged tile
        wrapper.classList.add("tile-merged");
        tile.mergedFrom.forEach(function (merged) {
            // Use the merged tile's *final* position for the temporary animation tile,
            // as it represents a tile that was at that spot and is now part of the merge.
            var tempMergedTile = new Tile({x: tile.x, y: tile.y}, merged.value);
            // Set its previousPosition to where it came from for animation effect
            tempMergedTile.previousPosition = merged.previousPosition || {x: merged.x, y: merged.y};

            // Call addTile recursively for these temporary visual elements.
            // They will appear, then be cleared in the next actuate cycle.
            self.addTile(tempMergedTile);
        });
    }
};
