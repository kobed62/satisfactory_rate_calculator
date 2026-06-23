const state = {
  items: [],
  choices: {},
  graph: null,
  effectiveGraph: null,
  resourceInputs: {},
  nodeClocks: {},
  positions: {},
  manualPositions: {},
  planKey: "",
  draggedNode: null,
  panning: null,
  zoom: 1,
  panelWidths: {left: 340, right: 320},
  pointerMoved: false,
};

const app = document.getElementById("app");
const itemInput = document.getElementById("itemInput");
const rateInput = document.getElementById("rateInput");
const strategyInput = document.getElementById("strategyInput");
const clockInput = document.getElementById("clockInput");
const simplifyRatiosInput = document.getElementById("simplifyRatiosInput");
const transportUnlockInputs = [...document.querySelectorAll("[data-transport][data-tier]")];
const errorBox = document.getElementById("error");
const choiceItem = document.getElementById("choiceItem");
const choiceRecipe = document.getElementById("choiceRecipe");
const choices = document.getElementById("choices");
const graphEl = document.getElementById("graph");
const graphShell = document.getElementById("graphShell");
const edgesEl = document.getElementById("edges");
const graphNotice = document.getElementById("graphNotice");
const recipeDrawer = document.getElementById("recipeDrawer");
const drawerTitle = document.getElementById("drawerTitle");
const recipeCards = document.getElementById("recipeCards");
const POWER_CLOCK_EXPONENT = 1.321928;
const POSITION_LAYOUT_VERSION = 2;

async function init() {
  setupPanelResize();
  setupGraphNavigation();
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
  showGraphNotice("");
  try {
    const rateValue = rateInput.value.trim();
    const payload = {
      item: itemInput.value,
      rate: rateValue ? Number(rateValue) : null,
      strategy: Object.keys(state.choices).length ? "custom" : strategyInput.value,
      recipe_choices: state.choices,
      clock_percent: selectedClockPercent(),
    };
    const nextPlanKey = planKeyForPayload(payload);
    if (state.planKey && state.planKey !== nextPlanKey) {
      state.nodeClocks = {};
    }
    state.planKey = nextPlanKey;
    state.manualPositions = loadManualPositions(state.planKey);
    const graph = await fetchJson("/api/calculate", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    state.graph = graph;
    syncResourceInputs(graph);
    renderCalculatedView();
  } catch (error) {
    const message = friendlyErrorMessage(error.message);
    errorBox.textContent = message;
    state.graph = null;
    state.effectiveGraph = null;
    renderGraph(null);
    renderOutputRate({item: itemInput.value, numbers_visible: false});
    renderSummary("machines", {});
    renderPower({numbers_visible: false});
    renderTransport({numbers_visible: false});
    renderSummary("resources", {});
    renderSummary("selectedRecipes", {});
    showGraphNotice(message, "error");
  }
}

function planKeyForPayload(payload) {
  const sortedChoices = Object.fromEntries(
    Object.entries(payload.recipe_choices || {}).sort(([left], [right]) => left.localeCompare(right))
  );
  return JSON.stringify({
    item: String(payload.item || "").trim().toLowerCase(),
    rate: payload.rate ?? null,
    strategy: payload.strategy,
    recipe_choices: sortedChoices,
  });
}

function positionStorageKey(planKey) {
  return `factoryPlanner.positions.v${POSITION_LAYOUT_VERSION}.${planKey}`;
}

function loadManualPositions(planKey) {
  if (!planKey) return {};
  try {
    return JSON.parse(localStorage.getItem(positionStorageKey(planKey)) || "{}");
  } catch {
    return {};
  }
}

function saveManualPositions() {
  if (!state.planKey) return;
  localStorage.setItem(positionStorageKey(state.planKey), JSON.stringify(state.manualPositions));
}

function renderCalculatedView() {
  const graph = graphForDisplay();
  state.effectiveGraph = graph;
  renderGraph(graph);
  renderGraphWarnings(graph);
  renderOutputRate(graph);
  renderSummary("machines", graph.numbers_visible ? graph.machines : {});
  renderPower(graph);
  renderTransport(graph);
  renderSummary("resources", graph.resources, "/min");
  renderSummary("selectedRecipes", graph.selected_recipes);
}

function friendlyErrorMessage(message) {
  if (message.includes("Unknown item")) {
    return "Unknown item. Check the spelling or choose an item from the list.";
  }
  if (message.includes("No recipe found")) {
    return "No usable recipe found for this item with the current data.";
  }
  if (message.includes("Recipe cycle detected") || message.includes("No cycle-free recipe")) {
    return "This recipe choice creates a production cycle. Try a different recipe in the drawer.";
  }
  return message || "Something went wrong while calculating this plan.";
}

function showGraphNotice(message, type = "info") {
  graphNotice.textContent = message;
  graphNotice.className = message ? `graph-notice ${type}` : "graph-notice hidden";
}

function renderGraphWarnings(graph) {
  if (!graph) return;
  const warnings = [];
  if ((graph.missing_icons || []).length) {
    warnings.push(`${graph.missing_icons.length} item icon${graph.missing_icons.length === 1 ? "" : "s"} missing.`);
  }
  const heavyEdges = (graph.edges || []).filter(edge => Number(edge.transport_hint?.lines || 0) > 1);
  if (heavyEdges.length) {
    warnings.push(`${heavyEdges.length} connection${heavyEdges.length === 1 ? "" : "s"} need multiple transport lines.`);
  }
  showGraphNotice(warnings.join(" "), warnings.length ? "warning" : ""); 
}

function selectedClockPercent() {
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
    return state.graph ? withNodeClocks(withUnlockedTransport(state.graph)) : state.graph;
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

  return withNodeClocks({
    ...graph,
    rate: cleanNumber(scale),
    numbers_visible: true,
    machines: scaleTotals(graph.machines, scale),
    power: scalePower(graph.power, scale),
    transport: transportSummary(scaledEdges),
    resources: Object.fromEntries(requiredNames.map(name => [name, cleanNumber(inputRates[name])])),
    nodes: graph.nodes.map(node => scaleNode(node, scale, inputRates)),
    edges: scaledEdges,
  });
}

function withUnlockedTransport(graph) {
  const edges = applyTransportUnlocks(graph.edges || []);
  return {
    ...graph,
    edges,
    transport: transportSummary(edges),
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
    base_machine_count: cleanNumber(Number(node.base_machine_count || node.machine_count) * scale),
    machine_count: cleanNumber(machineCount),
    display_machine_count: Math.max(1, Math.ceil(machineCount)),
    power_mw: cleanNumber(Number(node.power_mw || 0) * scale),
  };
}

function withNodeClocks(graph) {
  if (!graph.numbers_visible) return graph;

  const machines = {};
  const powerByBuilding = {};
  const nodes = (graph.nodes || []).map(node => {
    if (node.type === "resource") return node;
    const clockPercent = nodeClockPercent(node);
    const baseMachineCount = Number(node.base_machine_count || node.machine_count || 0);
    const machineCount = baseMachineCount / (clockPercent / 100);
    const powerMw = nodeBasePowerUsage(node) * machineCount * ((clockPercent / 100) ** POWER_CLOCK_EXPONENT);
    machines[node.building] = (machines[node.building] || 0) + machineCount;
    powerByBuilding[node.building] = (powerByBuilding[node.building] || 0) + powerMw;
    return {
      ...node,
      clock_percent: cleanNumber(clockPercent),
      machine_count: cleanNumber(machineCount),
      display_machine_count: Math.max(1, Math.ceil(machineCount)),
      power_mw: cleanNumber(powerMw),
    };
  });

  return {
    ...graph,
    nodes,
    machines: cleanTotals(machines),
    power: {
      total_mw: cleanNumber(Object.values(powerByBuilding).reduce((total, value) => total + value, 0)),
      by_building: cleanTotals(powerByBuilding),
    },
  };
}

function nodeClockPercent(node) {
  return Number(state.nodeClocks[node.id] || node.clock_percent || selectedClockPercent());
}

function nodeBasePowerUsage(node) {
  const machineCount = Number(node.machine_count || 0);
  const clockFactor = Number(node.clock_percent || 100) / 100;
  if (!machineCount || !clockFactor) return 0;
  return Number(node.power_mw || 0) / (machineCount * (clockFactor ** POWER_CLOCK_EXPONENT));
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
  return applyTransportUnlocks(scaledEdges);
}

function applyTransportUnlocks(edges) {
  return (edges || []).map(edge => {
    if (edge.rate === null || edge.rate === "") {
      return edge;
    }
    const rate = Number(edge.rate);
    return {
      ...edge,
      transport_hint: transportHint(edge.transport_type, rate),
    };
  });
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
  const capacities = unlockedTransportCapacities(transportType);
  for (const [standard, capacity] of capacities) {
    if (rate <= capacity) {
      return {standard, capacity, lines: 1, rate_per_line: cleanNumber(rate)};
    }
  }
  const [standard, capacity] = capacities[capacities.length - 1];
  const lines = Math.max(1, Math.ceil(rate / capacity));
  return {standard, capacity, lines, rate_per_line: cleanNumber(rate / lines)};
}

function unlockedTransportCapacities(transportType) {
  const type = transportType === "belt" ? "belt" : "pipe";
  const allCapacities = type === "belt"
    ? [["Mk.1 belt", 60], ["Mk.2 belt", 120], ["Mk.3 belt", 270], ["Mk.4 belt", 480], ["Mk.5 belt", 780], ["Mk.6 belt", 1200]]
    : [["Pipe Mk.1", 300], ["Pipe Mk.2", 600]];
  const highestTier = Math.max(
    1,
    ...transportUnlockInputs
      .filter(input => input.dataset.transport === type && input.checked)
      .map(input => Number(input.dataset.tier))
  );
  return allCapacities.slice(0, highestTier);
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 1e-9) return Math.round(value);
  return Number(value.toFixed(4));
}

function cleanTotals(values) {
  return Object.fromEntries(
    Object.entries(values || {})
      .filter(([, value]) => Math.abs(Number(value)) > 1e-9)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, cleanNumber(Number(value))])
  );
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

  state.positions = positionsForGraph(graph.nodes, graph.edges, graph.item);
  updateGraphBounds();
  applyGraphView();

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
    const clockControl = hasNumbers && node.type !== "resource"
      ? nodeClockControl(node)
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
        ${clockControl}
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
  graphEl.querySelectorAll(".node-clock-input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.value) {
        state.nodeClocks[input.dataset.nodeId] = Number(input.value);
      } else {
        delete state.nodeClocks[input.dataset.nodeId];
      }
      renderCalculatedView();
    });
  });
  renderEdges();
}

function positionsForGraph(nodes, edges, targetItem) {
  const positions = layoutNodes(nodes, edges, targetItem);
  for (const node of nodes) {
    const savedPosition = state.manualPositions[node.id];
    if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) {
      positions[node.id] = savedPosition;
    }
  }
  return positions;
}

function nodeClockControl(node) {
  const overrideValue = state.nodeClocks[node.id] ? String(state.nodeClocks[node.id]) : "";
  return `
    <label class="resource-input-label">
      <span>Clock %</span>
      <select class="node-clock-input" data-node-id="${escapeHtml(node.id)}">
        <option value="" ${overrideValue === "" ? "selected" : ""}>Default (${escapeHtml(selectedClockPercent())}%)</option>
        <option value="50" ${overrideValue === "50" ? "selected" : ""}>50%</option>
        <option value="100" ${overrideValue === "100" ? "selected" : ""}>100%</option>
        <option value="250" ${overrideValue === "250" ? "selected" : ""}>250%</option>
      </select>
    </label>
  `;
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
    const ratioText = flowRatioText(edge);
    text.textContent = edge.rate === null || edge.rate === "" ? "" : `${edge.rate}/min${transportText}${ratioText}`;
    edgesEl.appendChild(text);
  }
}

function flowRatioText(edge) {
  const parts = [];
  if (edge.split_ratio) {
    parts.push(`split ${formatRatio(edge.split_ratio)}`);
  }
  if (edge.merge_ratio) {
    parts.push(`merge ${formatRatio(edge.merge_ratio)}`);
  }
  return parts.length ? ` - ${parts.join(" - ")}` : "";
}

function formatRatio(ratio) {
  if (!simplifyRatiosInput.checked) {
    return ratio.fraction;
  }
  return approximateFraction(Number(ratio.part), Number(ratio.total_parts), 10);
}

function approximateFraction(numerator, denominator, maxPart) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return "";
  }

  const target = numerator / denominator;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let candidateDenominator = 1; candidateDenominator <= maxPart; candidateDenominator += 1) {
    for (let candidateNumerator = 0; candidateNumerator <= maxPart; candidateNumerator += 1) {
      const value = candidateNumerator / candidateDenominator;
      const error = Math.abs(value - target);
      if (error < bestError) {
        bestNumerator = candidateNumerator;
        bestDenominator = candidateDenominator;
        bestError = error;
      }
    }
  }

  const divisor = gcd(bestNumerator, bestDenominator);
  return `${bestNumerator / divisor}/${bestDenominator / divisor}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function syncTransportUnlocks(changedInput) {
  const type = changedInput.dataset.transport;
  const tier = Number(changedInput.dataset.tier);
  for (const input of transportUnlockInputs.filter(candidate => candidate.dataset.transport === type)) {
    const inputTier = Number(input.dataset.tier);
    if (changedInput.checked && inputTier < tier) {
      input.checked = true;
    }
    if (!changedInput.checked && inputTier > tier) {
      input.checked = false;
    }
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
    if (state.pointerMoved && state.draggedNode) {
      state.manualPositions[state.draggedNode.id] = state.positions[state.draggedNode.id];
      saveManualPositions();
    }
    state.draggedNode = null;
    if (shouldOpen) {
      openRecipeDrawer(nodeEl.dataset.label);
    }
  });
}

function graphPointer(event) {
  const rect = graphEl.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / state.zoom,
    y: (event.clientY - rect.top) / state.zoom,
  };
}

async function openRecipeDrawer(itemName) {
  drawerTitle.textContent = itemName;
  recipeCards.innerHTML = `<div class="summary-row"><span>Loading</span><strong></strong></div>`;
  recipeDrawer.classList.add("open");
  recipeDrawer.setAttribute("aria-hidden", "false");

  try {
    const recipes = await fetchJson(`/api/recipes?item=${encodeURIComponent(itemName)}`);
    renderRecipeCards(itemName, recipes);
  } catch (error) {
    recipeCards.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderRecipeCards(itemName, recipes) {
  recipeCards.innerHTML = recipes.map(recipe => recipeCard(itemName, recipe)).join("");
  recipeCards.querySelectorAll("button[data-recipe]").forEach(button => {
    button.addEventListener("click", () => {
      setRecipeChoice(itemName, button.dataset.recipe);
      renderRecipeCards(itemName, recipes);
    });
  });
}

function recipeCard(itemName, recipe) {
  const activeRecipe = state.choices[itemName] || state.graph?.selected_recipes?.[itemName];
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

function setupGraphNavigation() {
  document.getElementById("zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.2));
  document.getElementById("zoomOutButton").addEventListener("click", () => setZoom(state.zoom / 1.2));
  document.getElementById("fitGraphButton").addEventListener("click", fitGraph);
  document.getElementById("resetViewButton").addEventListener("click", resetGraphView);

  graphShell.addEventListener("wheel", event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const nextZoom = state.zoom * (event.deltaY < 0 ? 1.1 : 0.9);
    setZoom(nextZoom, event.clientX, event.clientY);
  }, {passive: false});

  graphShell.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest(".node, button, input, select")) return;
    state.panning = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: graphShell.scrollLeft,
      scrollTop: graphShell.scrollTop,
    };
    graphShell.classList.add("panning");
    graphShell.setPointerCapture(event.pointerId);
  });

  graphShell.addEventListener("pointermove", event => {
    if (!state.panning) return;
    graphShell.scrollLeft = state.panning.scrollLeft - (event.clientX - state.panning.startX);
    graphShell.scrollTop = state.panning.scrollTop - (event.clientY - state.panning.startY);
  });

  graphShell.addEventListener("pointerup", event => {
    if (!state.panning || state.panning.pointerId !== event.pointerId) return;
    state.panning = null;
    graphShell.classList.remove("panning");
  });
}

function setZoom(nextZoom, anchorX = null, anchorY = null) {
  const previousZoom = state.zoom;
  state.zoom = Math.min(2.4, Math.max(0.35, nextZoom));
  if (state.zoom === previousZoom) return;

  const rect = graphShell.getBoundingClientRect();
  const localX = anchorX === null ? rect.width / 2 : anchorX - rect.left;
  const localY = anchorY === null ? rect.height / 2 : anchorY - rect.top;
  const graphX = (graphShell.scrollLeft + localX) / previousZoom;
  const graphY = (graphShell.scrollTop + localY) / previousZoom;
  applyGraphView();
  graphShell.scrollLeft = graphX * state.zoom - localX;
  graphShell.scrollTop = graphY * state.zoom - localY;
}

function applyGraphView() {
  graphEl.style.zoom = state.zoom;
  renderEdges();
}

function fitGraph() {
  const bounds = graphBounds(state.positions);
  const rect = graphShell.getBoundingClientRect();
  const nextZoom = Math.min(1.4, Math.max(0.35, Math.min(
    (rect.width - 80) / bounds.width,
    (rect.height - 80) / bounds.height
  )));
  state.zoom = nextZoom;
  applyGraphView();
  graphShell.scrollLeft = 0;
  graphShell.scrollTop = 0;
}

function resetGraphView() {
  state.zoom = 1;
  applyGraphView();
  graphShell.scrollLeft = 0;
  graphShell.scrollTop = 0;
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

function layoutNodes(nodes, edges, targetItem) {
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge.target);
  }

  const targetIds = new Set(
    nodes
      .filter(node => node.type !== "resource" && node.label === targetItem)
      .map(node => node.id)
  );
  if (!targetIds.size) {
    for (const node of nodes) {
      if ((outgoing.get(node.id) || []).length === 0) {
        targetIds.add(node.id);
      }
    }
  }

  const distanceMemo = {};
  function distanceToTarget(id, path = []) {
    if (distanceMemo[id] !== undefined) return distanceMemo[id];
    if (targetIds.has(id)) {
      distanceMemo[id] = 0;
      return 0;
    }
    if (path.includes(id)) {
      distanceMemo[id] = 0;
      return 0;
    }
    const children = outgoing.get(id) || [];
    if (!children.length) {
      distanceMemo[id] = 0;
      return 0;
    }
    distanceMemo[id] = Math.max(...children.map(childId => distanceToTarget(childId, [...path, id]))) + 1;
    return distanceMemo[id];
  }

  const distances = Object.fromEntries(nodes.map(node => [node.id, distanceToTarget(node.id)]));
  const maxDistance = Math.max(0, ...Object.values(distances));
  const columns = {};
  for (const node of nodes) {
    const d = maxDistance - distances[node.id];
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
  calculate();
});
simplifyRatiosInput.addEventListener("change", renderEdges);
transportUnlockInputs.forEach(input => {
  input.addEventListener("change", () => {
    syncTransportUnlocks(input);
    renderCalculatedView();
  });
});
choiceItem.addEventListener("change", loadRecipesForChoice);
itemInput.addEventListener("change", () => {
  choiceItem.value = itemInput.value;
  loadRecipesForChoice();
});

init();
