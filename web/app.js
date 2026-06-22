const state = {
  items: [],
  choices: {},
  graph: null,
  effectiveGraph: null,
  resourceInputs: {},
  positions: {},
  draggedNode: null,
  panelWidths: {left: 340, right: 320},
  pointerMoved: false,
};

const app = document.getElementById("app");
const itemInput = document.getElementById("itemInput");
const rateInput = document.getElementById("rateInput");
const strategyInput = document.getElementById("strategyInput");
const clockInput = document.getElementById("clockInput");
const customClockInput = document.getElementById("customClockInput");
const errorBox = document.getElementById("error");
const choiceItem = document.getElementById("choiceItem");
const choiceRecipe = document.getElementById("choiceRecipe");
const choices = document.getElementById("choices");
const graphEl = document.getElementById("graph");
const edgesEl = document.getElementById("edges");
const recipeDrawer = document.getElementById("recipeDrawer");
const drawerTitle = document.getElementById("drawerTitle");
const recipeCards = document.getElementById("recipeCards");

async function init() {
  setupPanelResize();
  const savedWidths = JSON.parse(localStorage.getItem("panelWidths") || "null");
  if (savedWidths) {
    state.panelWidths = savedWidths;
    applyPanelWidths();
  }

  const items = await fetchJson("/api/items");
  state.items = items;
  document.getElementById("itemsList").innerHTML = items
    .map(item => `<option value="${escapeHtml(item)}"></option>`)
    .join("");
  await loadRecipesForChoice();
  await calculate();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function calculate() {
  errorBox.textContent = "";
  try {
    const rateValue = rateInput.value.trim();
    const payload = {
      item: itemInput.value,
      rate: rateValue ? Number(rateValue) : null,
      strategy: Object.keys(state.choices).length ? "custom" : strategyInput.value,
      recipe_choices: state.choices,
      clock_percent: selectedClockPercent(),
    };
    const graph = await fetchJson("/api/calculate", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    state.graph = graph;
    syncResourceInputs(graph);
    renderCalculatedView();
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

function renderCalculatedView() {
  const graph = graphForDisplay();
  state.effectiveGraph = graph;
  renderGraph(graph);
  renderOutputRate(graph);
  renderSummary("machines", graph.numbers_visible ? graph.machines : {});
  renderPower(graph);
  renderTransport(graph);
  renderSummary("resources", graph.resources, "/min");
  renderSummary("selectedRecipes", graph.selected_recipes);
}

function selectedClockPercent() {
  if (clockInput.value === "custom") {
    return Number(customClockInput.value) || 100;
  }
  return Number(clockInput.value);
}

function renderOutputRate(graph) {
  const outputRate = document.getElementById("outputRate");
  const value = graph.numbers_visible && graph.rate !== null && graph.rate !== ""
    ? `${escapeHtml(graph.rate)}/min`
    : "";
  outputRate.innerHTML = `
    <div class="summary-row">
      <span>${escapeHtml(graph.item || "Output")}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderPower(graph) {
  if (!graph.numbers_visible) {
    renderSummary("power", {});
    return;
  }
  const power = graph.power || {};
  const rows = {
    "Total": power.total_mw === "" || power.total_mw === undefined ? "" : power.total_mw,
    ...(power.by_building || {}),
  };
  renderSummary("power", rows, " MW");
}

function renderTransport(graph) {
  if (!graph.numbers_visible) {
    renderSummary("transport", {});
    return;
  }
  const transport = graph.transport || transportSummary(graph.edges || []);
  renderSummary("transport", transport.by_standard || {});
}

function syncResourceInputs(graph) {
  if (graph.mode !== "input_limits") return;
  const resourceNames = Object.keys(graph.resources || {});
  state.resourceInputs = Object.fromEntries(
    resourceNames.map(name => [name, state.resourceInputs[name] || ""])
  );
}

function graphForDisplay() {
  if (!state.graph || state.graph.mode !== "input_limits") {
    return state.graph;
  }

  const graph = state.graph;
  const resourceRequirements = graph.resources || {};
  const requiredNames = Object.keys(resourceRequirements);
  const inputRates = Object.fromEntries(
    requiredNames.map(name => [name, Number(state.resourceInputs[name])])
  );
  const hasAllInputs = requiredNames.length > 0
    && requiredNames.every(name => Number.isFinite(inputRates[name]) && inputRates[name] > 0);

  if (!hasAllInputs) {
    return {
      ...graph,
      numbers_visible: false,
      machines: {},
      power: {total_mw: "", by_building: {}},
      transport: {by_standard: {}},
      resources: Object.fromEntries(
        requiredNames.map(name => [name, state.resourceInputs[name] || ""])
      ),
      nodes: graph.nodes.map(node => ({
        ...node,
        rate: null,
        machine_count: null,
        display_machine_count: null,
      })),
      edges: graph.edges.map(edge => ({...edge, rate: null})),
    };
  }

  const scale = Math.min(
    ...requiredNames.map(name => inputRates[name] / Number(resourceRequirements[name]))
  );
  const scaledEdges = scaleEdges(graph.edges, scale);

  return {
    ...graph,
    rate: cleanNumber(scale),
    numbers_visible: true,
    machines: scaleTotals(graph.machines, scale),
    power: scalePower(graph.power, scale),
    transport: transportSummary(scaledEdges),
    resources: Object.fromEntries(requiredNames.map(name => [name, cleanNumber(inputRates[name])])),
    nodes: graph.nodes.map(node => scaleNode(node, scale, inputRates)),
    edges: scaledEdges,
  };
}

function scaleNode(node, scale, inputRates) {
  if (node.type === "resource") {
    return {
      ...node,
      rate: cleanNumber(inputRates[node.label] || 0),
    };
  }

  const machineCount = Number(node.machine_count) * scale;
  return {
    ...node,
    rate: cleanNumber(Number(node.rate) * scale),
    machine_count: cleanNumber(machineCount),
    display_machine_count: Math.max(1, Math.ceil(machineCount)),
    power_mw: cleanNumber(Number(node.power_mw || 0) * scale),
  };
}

function scaleTotals(values, scale) {
  return Object.fromEntries(
    Object.entries(values || {}).map(([name, value]) => [name, cleanNumber(Number(value) * scale)])
  );
}

function scalePower(power, scale) {
  return {
    total_mw: cleanNumber(Number(power?.total_mw || 0) * scale),
    by_building: scaleTotals(power?.by_building || {}, scale),
  };
}

function scaleEdges(edges, scale) {
  const scaledEdges = (edges || []).map(edge => {
    const rate = Number(edge.rate) * scale;
    return {
      ...edge,
      rate: cleanNumber(rate),
      transport_hint: transportHint(edge.transport_type, rate),
    };
  });
  return scaledEdges;
}

function transportSummary(edges) {
  const totals = {};
  for (const edge of edges || []) {
    const hint = edge.transport_hint || transportHint(edge.transport_type, Number(edge.rate || 0));
    totals[hint.standard] = (totals[hint.standard] || 0) + Number(hint.lines || 0);
  }
  return {by_standard: totals};
}

function transportHint(transportType, rate) {
  const capacities = transportType === "belt"
    ? [["Mk.1 belt", 60], ["Mk.2 belt", 120], ["Mk.3 belt", 270], ["Mk.4 belt", 480], ["Mk.5 belt", 780], ["Mk.6 belt", 1200]]
    : [["Pipe Mk.1", 300], ["Pipe Mk.2", 600]];
  for (const [standard, capacity] of capacities) {
    if (rate <= capacity) {
      return {standard, capacity, lines: 1, rate_per_line: cleanNumber(rate)};
    }
  }
  const [standard, capacity] = capacities[capacities.length - 1];
  const lines = Math.max(1, Math.ceil(rate / capacity));
  return {standard, capacity, lines, rate_per_line: cleanNumber(rate / lines)};
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 1e-9) return Math.round(value);
  return Number(value.toFixed(4));
}

async function loadRecipesForChoice() {
  const item = choiceItem.value || itemInput.value;
  if (!item) return;
  try {
    const recipes = await fetchJson(`/api/recipes?item=${encodeURIComponent(item)}`);
    choiceRecipe.innerHTML = recipes
      .map(recipe => `<option value="${escapeHtml(recipe.name)}">${escapeHtml(recipe.name)} (${escapeHtml(recipe.building || "Manual")})</option>`)
      .join("");
  } catch {
    choiceRecipe.innerHTML = "";
  }
}

function addChoice() {
  if (!choiceItem.value || !choiceRecipe.value) return;
  setRecipeChoice(choiceItem.value, choiceRecipe.value);
}

function setRecipeChoice(item, recipe) {
  state.choices[item] = recipe;
  strategyInput.value = "custom";
  renderChoices();
  calculate();
}

function renderChoices() {
  choices.innerHTML = Object.entries(state.choices).map(([item, recipe]) => `
    <div class="choice-row">
      <strong>${escapeHtml(item)}</strong>
      <span>${escapeHtml(recipe)}</span>
      <button class="secondary" data-item="${escapeHtml(item)}">Remove</button>
    </div>
  `).join("");

  choices.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      delete state.choices[button.dataset.item];
      renderChoices();
      calculate();
    });
  });
}

function renderSummary(targetId, values, suffix = "") {
  const target = document.getElementById(targetId);
  target.innerHTML = Object.entries(values || {}).map(([name, value]) => `
    <div class="summary-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}${value === "" ? "" : suffix}</strong></div>
  `).join("") || `<div class="summary-row"><span>None</span><strong></strong></div>`;
}

function renderGraph(graph) {
  graphEl.querySelectorAll(".node").forEach(node => node.remove());
  edgesEl.innerHTML = "";
  if (!graph) return;

  state.positions = layoutNodes(graph.nodes, graph.edges);
  updateGraphBounds();

  for (const node of graph.nodes) {
    const pos = state.positions[node.id];
    const nodeEl = document.createElement("div");
    nodeEl.className = `node ${node.type}`;
    nodeEl.dataset.id = node.id;
    nodeEl.dataset.label = node.label;
    nodeEl.dataset.type = node.type;
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
    const icon = node.icon ? `<img src="/${escapeHtml(node.icon)}" alt="">` : "";
    const hasNumbers = graph.numbers_visible;
    const rateLine = hasNumbers && node.rate !== null && node.rate !== ""
      ? `<div><span class="rate">${escapeHtml(node.rate)}/min</span></div>`
      : "";
    const resourceInput = graph.mode === "input_limits" && node.type === "resource"
      ? resourceInputControl(node.label)
      : "";
    const machineLine = node.type === "resource"
      ? "raw resource"
      : hasNumbers
        ? `${node.display_machine_count} ${node.building}${node.display_machine_count === 1 ? "" : "s"}`
        : `${node.building}`;
    const powerLine = hasNumbers && node.type !== "resource" && node.power_mw
      ? `<div>${escapeHtml(node.power_mw)} MW @ ${escapeHtml(node.clock_percent)}%</div>`
      : "";
    nodeEl.innerHTML = `
      <div class="node-header">
        ${icon}
        <div class="node-title">${escapeHtml(node.label)}</div>
      </div>
      <div class="node-meta">
        ${rateLine}
        <div>${escapeHtml(machineLine)}</div>
        ${powerLine}
        <div>${escapeHtml(node.recipe || "")}</div>
        ${resourceInput}
      </div>
    `;
    makeNodeInteractive(nodeEl);
    graphEl.appendChild(nodeEl);
  }

  graphEl.querySelectorAll(".resource-rate-input").forEach(input => {
    input.addEventListener("change", () => {
      state.resourceInputs[input.dataset.resource] = input.value.trim();
      renderCalculatedView();
    });
  });
  renderEdges();
}

function resourceInputControl(resourceName) {
  const value = state.resourceInputs[resourceName] || "";
  return `
    <label class="resource-input-label">
      <span>Input/min</span>
      <input class="resource-rate-input" data-resource="${escapeHtml(resourceName)}" type="number" min="0" step="0.1" value="${escapeHtml(value)}">
    </label>
  `;
}

function renderEdges() {
  edgesEl.innerHTML = "";
  if (!state.effectiveGraph) return;

  for (const edge of state.effectiveGraph.edges) {
    const source = state.positions[edge.source];
    const target = state.positions[edge.target];
    if (!source || !target) continue;
    const x1 = source.x + 210;
    const y1 = source.y + 58;
    const x2 = target.x;
    const y2 = target.y + 58;
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", edge.transport_type === "pipe" ? "#70c7ff" : "#f2a42b");
    path.setAttribute("stroke-width", "3");
    edgesEl.appendChild(path);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", (y1 + y2) / 2 - 8);
    text.setAttribute("class", "edge-label");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    const hint = edge.transport_hint;
    const transportText = hint ? ` - ${hint.lines}x ${hint.standard}` : "";
    text.textContent = edge.rate === null || edge.rate === "" ? "" : `${edge.rate}/min${transportText}`;
    edgesEl.appendChild(text);
  }
}

function makeNodeInteractive(nodeEl) {
  nodeEl.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    if (event.target.closest("input, button, select")) return;
    const id = nodeEl.dataset.id;
    const position = state.positions[id];
    const pointer = graphPointer(event);
    state.pointerMoved = false;
    state.draggedNode = {
      id,
      element: nodeEl,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: pointer.x - position.x,
      offsetY: pointer.y - position.y,
    };
    nodeEl.classList.add("dragging");
    nodeEl.setPointerCapture(event.pointerId);
  });

  nodeEl.addEventListener("pointermove", event => {
    if (!state.draggedNode || state.draggedNode.element !== nodeEl) return;
    if (Math.abs(event.clientX - state.draggedNode.startX) > 3 || Math.abs(event.clientY - state.draggedNode.startY) > 3) {
      state.pointerMoved = true;
    }
    const pointer = graphPointer(event);
    const x = Math.max(20, pointer.x - state.draggedNode.offsetX);
    const y = Math.max(20, pointer.y - state.draggedNode.offsetY);
    state.positions[state.draggedNode.id] = {x, y};
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;
    updateGraphBounds();
    renderEdges();
  });

  nodeEl.addEventListener("pointerup", () => {
    nodeEl.classList.remove("dragging");
    const shouldOpen = !state.pointerMoved && nodeEl.dataset.type !== "resource";
    state.draggedNode = null;
    if (shouldOpen) {
      openRecipeDrawer(nodeEl.dataset.label);
    }
  });
}

function graphPointer(event) {
  const rect = graphEl.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

async function openRecipeDrawer(itemName) {
  drawerTitle.textContent = itemName;
  recipeCards.innerHTML = `<div class="summary-row"><span>Loading</span><strong></strong></div>`;
  recipeDrawer.classList.add("open");
  recipeDrawer.setAttribute("aria-hidden", "false");

  try {
    const recipes = await fetchJson(`/api/recipes?item=${encodeURIComponent(itemName)}`);
    recipeCards.innerHTML = recipes.map(recipe => recipeCard(itemName, recipe)).join("");
    recipeCards.querySelectorAll("button[data-recipe]").forEach(button => {
      button.addEventListener("click", () => {
        setRecipeChoice(itemName, button.dataset.recipe);
      });
    });
  } catch (error) {
    recipeCards.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function recipeCard(itemName, recipe) {
  const activeRecipe = state.graph?.selected_recipes?.[itemName];
  const isActive = activeRecipe === recipe.name;
  const badgeClass = recipe.alternate ? "badge" : "badge default";
  const badgeText = recipe.alternate ? "Alternate" : "Default";
  return `
    <article class="recipe-card ${isActive ? "active" : ""}">
      <div class="recipe-title-row">
        <div>
          <strong>${escapeHtml(recipe.name)}</strong>
          <div class="node-meta">${escapeHtml(recipe.building || "Manual")} - ${escapeHtml(recipe.duration)}s</div>
        </div>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <div class="recipe-details">
        <section>
          <h3>Inputs</h3>
          ${amountList(recipe.inputs)}
        </section>
        <section>
          <h3>Outputs</h3>
          ${amountList(recipe.outputs)}
        </section>
      </div>
      <button data-recipe="${escapeHtml(recipe.name)}">${isActive ? "Selected" : "Use Recipe"}</button>
    </article>
  `;
}

function amountList(values) {
  const entries = Object.entries(values || {});
  if (!entries.length) return "<ul><li>None</li></ul>";
  return `<ul>${entries.map(([name, amount]) => `<li>${escapeHtml(amount)} ${escapeHtml(name)}</li>`).join("")}</ul>`;
}

function closeRecipeDrawer() {
  recipeDrawer.classList.remove("open");
  recipeDrawer.setAttribute("aria-hidden", "true");
}

function setupPanelResize() {
  document.getElementById("leftSplitter").addEventListener("pointerdown", event => {
    startPanelDrag(event, "left");
  });
  document.getElementById("rightSplitter").addEventListener("pointerdown", event => {
    startPanelDrag(event, "right");
  });
}

function startPanelDrag(event, side) {
  const splitter = event.currentTarget;
  splitter.classList.add("dragging");
  splitter.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = state.panelWidths[side];

  function onMove(moveEvent) {
    const delta = moveEvent.clientX - startX;
    const nextWidth = side === "left" ? startWidth + delta : startWidth - delta;
    state.panelWidths[side] = Math.min(620, Math.max(220, nextWidth));
    applyPanelWidths();
  }

  function onUp() {
    splitter.classList.remove("dragging");
    splitter.removeEventListener("pointermove", onMove);
    splitter.removeEventListener("pointerup", onUp);
    localStorage.setItem("panelWidths", JSON.stringify(state.panelWidths));
  }

  splitter.addEventListener("pointermove", onMove);
  splitter.addEventListener("pointerup", onUp);
}

function applyPanelWidths() {
  app.style.gridTemplateColumns = `${state.panelWidths.left}px 8px 1fr 8px ${state.panelWidths.right}px`;
  setTimeout(renderEdges, 0);
}

function updateGraphBounds() {
  const graphSize = graphBounds(state.positions);
  graphEl.style.width = `${graphSize.width}px`;
  graphEl.style.height = `${graphSize.height}px`;
}

function graphBounds(positions) {
  const points = Object.values(positions);
  if (!points.length) return {width: 1200, height: 800};
  return {
    width: Math.max(1200, Math.max(...points.map(point => point.x)) + 300),
    height: Math.max(800, Math.max(...points.map(point => point.y)) + 220),
  };
}

function layoutNodes(nodes, edges) {
  const incoming = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source);
  }

  const depthMemo = {};
  function depth(id) {
    if (depthMemo[id] !== undefined) return depthMemo[id];
    const parents = incoming.get(id) || [];
    if (!parents.length) {
      depthMemo[id] = 0;
      return 0;
    }
    depthMemo[id] = Math.max(...parents.map(depth)) + 1;
    return depthMemo[id];
  }

  const columns = {};
  for (const node of nodes) {
    const d = depth(node.id);
    columns[d] = columns[d] || [];
    columns[d].push(node);
  }

  const positions = {};
  for (const [column, columnNodes] of Object.entries(columns)) {
    columnNodes.forEach((node, index) => {
      positions[node.id] = {
        x: 60 + Number(column) * 310,
        y: 50 + index * 160,
      };
    });
  }
  return positions;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

document.getElementById("calculateButton").addEventListener("click", calculate);
document.getElementById("addChoiceButton").addEventListener("click", addChoice);
document.getElementById("closeDrawerButton").addEventListener("click", closeRecipeDrawer);
clockInput.addEventListener("change", () => {
  customClockInput.classList.toggle("hidden", clockInput.value !== "custom");
  calculate();
});
customClockInput.addEventListener("change", calculate);
choiceItem.addEventListener("change", loadRecipesForChoice);
itemInput.addEventListener("change", () => {
  choiceItem.value = itemInput.value;
  loadRecipesForChoice();
});

init();
