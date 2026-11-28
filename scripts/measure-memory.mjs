// Heap cost of data and bindings, JSONModel vs SignalModel, in headless Chrome.
// Usage: npm run start:lib (in another terminal), then npm run bench:memory
import { remote } from "webdriverio";

const browser = await remote({
  logLevel: "silent",
  capabilities: {
    browserName: "chrome",
    "goog:chromeOptions": {
      args: ["--headless", "--enable-precise-memory-info", "--js-flags=--expose-gc"],
    },
  },
});
let result;
try {
  await browser.setTimeout({ script: 600000 });
  await browser.url("http://localhost:8080/test-resources/ui5/model/signal/benchmark/index.html");

  result = await browser.executeAsync((done) => {
    sap.ui.require(
      ["sap/ui/model/json/JSONModel", "ui5/model/signal/SignalModel", "sap/m/Text"],
      async (JSONModel, SignalModel, Text) => {
        const heap = async () => {
          for (let i = 0; i < 4; i++) {
            gc();
            await new Promise((r) => setTimeout(r, 30));
          }
          return performance.memory.usedJSHeapSize;
        };
        const rows = (n) =>
          Array.from({ length: n }, (_, i) => ({
            id: i,
            name: "Item " + i,
            value: i * 1.5,
            active: i % 2 === 0,
            meta: { name: "meta " + i, tags: ["a" + i, "b" + i] },
          }));
        const N = 20000;
        const SHAPES = {
          "data only": { data: () => ({ items: rows(N) }), paths: [] },
          "/kN (top level)": {
            data: () => Object.fromEntries(Array.from({ length: N }, (_, i) => ["k" + i, "v" + i])),
            paths: Array.from({ length: N }, (_, i) => "/k" + i),
          },
          "/items/N/name": {
            data: () => ({ items: rows(N) }),
            paths: Array.from({ length: N }, (_, i) => "/items/" + i + "/name"),
          },
          "/items/N/meta/tags/0 (5 segments)": {
            data: () => ({ items: rows(N) }),
            paths: Array.from({ length: N }, (_, i) => "/items/" + i + "/meta/tags/0"),
          },
          "/a/b/c/d/items/N/meta/name (8 segments)": {
            data: () => ({ a: { b: { c: { d: { items: rows(N) } } } } }),
            paths: Array.from({ length: N }, (_, i) => "/a/b/c/d/items/" + i + "/meta/name"),
          },
          "5 bindings per row (/items/N/*)": {
            data: () => ({ items: rows(N / 5) }),
            paths: Array.from({ length: N / 5 }, (_, i) =>
              ["id", "name", "value", "active", "meta/name"].map((p) => "/items/" + i + "/" + p),
            ).flat(),
          },
        };
        const out = { N, dataJson: JSON.stringify({ items: rows(N) }).length, rows: [] };
        const measure = async (build) => {
          const samples = [];
          for (let run = 0; run < 3; run++) {
            const before = await heap();
            let kept = build();
            const after = await heap();
            samples.push(after - before);
            kept.destroy();
            kept = null;
          }
          return samples.toSorted((a, b) => a - b)[1];
        };
        for (const [name, shape] of Object.entries(SHAPES)) {
          for (const [label, Model] of [
            ["JSONModel", JSONModel],
            ["SignalModel", SignalModel],
          ]) {
            const dataOnly = await measure(() => {
              const model = new Model(shape.data());
              return { destroy: () => model.destroy() };
            });
            const withBindings = shape.paths.length
              ? await measure(() => {
                  const model = new Model(shape.data());
                  const bindings = shape.paths.map((path) => {
                    const binding = model.bindProperty(path);
                    binding.attachChange(() => {});
                    binding.initialize();
                    return binding;
                  });
                  return { bindings, destroy: () => model.destroy() };
                })
              : dataOnly;
            out.rows.push({ name, label, dataOnly, withBindings, count: shape.paths.length });
          }
        }
        // Bound controls (not rendered): what a binding costs next to its control
        const C = 5000;
        for (const [label, Model] of [
          ["JSONModel", JSONModel],
          ["SignalModel", SignalModel],
        ]) {
          const controls = await measure(() => {
            const model = new Model({ items: rows(C) });
            const texts = Array.from({ length: C }, () => new Text({ text: "x" }).setModel(model));
            return { destroy: () => (texts.forEach((t) => t.destroy()), model.destroy()) };
          });
          const bound = await measure(() => {
            const model = new Model({ items: rows(C) });
            const texts = Array.from({ length: C }, (_, i) =>
              new Text({ text: "{/items/" + i + "/name}" }).setModel(model),
            );
            return { destroy: () => (texts.forEach((t) => t.destroy()), model.destroy()) };
          });
          out.rows.push({
            name: "sap.m.Text bound to /items/N/name",
            label,
            dataOnly: controls,
            withBindings: bound,
            count: C,
          });
        }
        // One list binding over all rows
        for (const [label, Model] of [
          ["JSONModel", JSONModel],
          ["SignalModel", SignalModel],
        ]) {
          const dataOnly = await measure(() => {
            const model = new Model({ items: rows(N) });
            return { destroy: () => model.destroy() };
          });
          const withList = await measure(() => {
            const model = new Model({ items: rows(N) });
            const binding = model.bindList("/items");
            binding.attachChange(() => {});
            binding.initialize();
            binding.getContexts(0, N);
            return { binding, destroy: () => model.destroy() };
          });
          out.rows.push({
            name: "one list binding, all rows read",
            label,
            dataOnly,
            withBindings: withList,
            count: N,
          });
        }
        done(out);
      },
    );
  });
} finally {
  await browser.deleteSession();
}

console.log(
  `N = ${result.N}; ${result.N} rows as JSON text: ${(result.dataJson / 1e6).toFixed(2)} MB`,
);
for (const r of result.rows) {
  const per = r.count ? ((r.withBindings - r.dataOnly) / r.count).toFixed(0) : "-";
  console.log(
    `${r.name.padEnd(42)} ${r.label.padEnd(12)} data ${(r.dataOnly / 1e6).toFixed(2).padStart(6)} MB  with bindings ${(r.withBindings / 1e6).toFixed(2).padStart(6)} MB  per binding ${per.padStart(5)} B`,
  );
}
