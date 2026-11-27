import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import MockServer from "sap/ui/core/util/MockServer";

const BASE = "/test-resources/ui5/model/signal/qunit/testdata";
const SAMPLE_URL = `${BASE}/sample.json`;
const MALFORMED_URL = `${BASE}/malformed.txt`;
const MERGE_URL = `${BASE}/merge.json`;
const BAD_URL = `${BASE}/does-not-exist.json`;

QUnit.module("loadData", () => {
  // =========================================================================
  // Constructor with URL
  // =========================================================================

  QUnit.test("constructor with URL loads data asynchronously", (assert) => {
    const done = assert.async();
    const model = new SignalModel(SAMPLE_URL);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "name loaded");
      assert.strictEqual(model.getProperty("/age"), 28, "age loaded");
      assert.strictEqual(model.getProperty("/customer/firstName"), "Alice", "nested data loaded");
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // loadData -- basic
  // =========================================================================

  QUnit.test("loadData loads JSON and sets model data", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.loadData(SAMPLE_URL);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "name loaded");
      assert.deepEqual(
        model.getProperty("/items/0"),
        { id: 1, label: "Alpha" },
        "array item loaded",
      );
      model.destroy();
      done();
    });
  });

  QUnit.test("loadData with merge preserves existing data", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({ existing: true, age: 25 });

    model.loadData(MERGE_URL, undefined, undefined, undefined, true);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/existing"), true, "existing property preserved");
      assert.strictEqual(model.getProperty("/age"), 30, "age overwritten by merge");
      assert.strictEqual(
        model.getProperty("/customer/address/city"),
        "Munich",
        "deep merged value loaded",
      );
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // dataLoaded() promise
  // =========================================================================

  QUnit.test("dataLoaded resolves after loadData completes", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "data available after dataLoaded");
      model.destroy();
      done();
    });
  });

  QUnit.test("dataLoaded resolves immediately when no load is pending", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });

    let resolved = 0;
    void model.dataLoaded().then(() => {
      resolved++;
    });

    // "Immediately" = within the microtask queue, before any timer or network task
    setTimeout(() => {
      assert.strictEqual(resolved, 1, "dataLoaded resolved before the next task");
      model.destroy();
      done();
    }, 0);
  });

  // =========================================================================
  // Events
  // =========================================================================

  QUnit.test("requestSent event fires before load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    let sent: Record<string, unknown> | undefined;

    model.attachRequestSent((oEvent) => {
      sent = oEvent.getParameters() as Record<string, unknown>;
    });

    model.attachRequestCompleted(() => {
      assert.strictEqual(sent?.url, SAMPLE_URL, "requestSent fired first, with the URL");
      assert.strictEqual(sent?.type, "GET", "requestSent carries the HTTP method");
      model.destroy();
      done();
    });

    model.loadData(SAMPLE_URL);
  });

  QUnit.test("requestFailed fires for bad URL", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.attachRequestFailed(() => {
      assert.ok(true, "requestFailed fired for non-existent URL");
      model.destroy();
      done();
    });

    model.loadData(BAD_URL);
  });

  // =========================================================================
  // JSONModel parity
  // =========================================================================

  QUnit.test("loadData produces identical data to JSONModel", (assert) => {
    const done = assert.async();
    const json = new JSONModel();
    const signal = new SignalModel<Record<string, unknown>>();

    let jsonDone = 0;
    let signalDone = 0;

    function checkBoth(): void {
      if (jsonDone && signalDone) {
        assert.deepEqual(signal.getData(), json.getData(), "loaded data matches JSONModel");
        json.destroy();
        signal.destroy();
        done();
      }
    }

    json.attachRequestCompleted(() => {
      jsonDone++;
      checkBoth();
    });
    signal.attachRequestCompleted(() => {
      signalDone++;
      checkBoth();
    });

    json.loadData(SAMPLE_URL);
    signal.loadData(SAMPLE_URL);
  });

  QUnit.test("loadData with merge produces identical data to JSONModel", (assert) => {
    const done = assert.async();
    const initial = { existing: true, age: 25 };
    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    let jsonDone = 0;
    let signalDone = 0;

    function checkBoth(): void {
      if (jsonDone && signalDone) {
        assert.deepEqual(signal.getData(), json.getData(), "merged data matches JSONModel");
        assert.strictEqual(signal.getProperty("/existing"), true, "existing preserved");
        assert.strictEqual(signal.getProperty("/age"), 30, "age merged");
        json.destroy();
        signal.destroy();
        done();
      }
    }

    json.attachRequestCompleted(() => {
      jsonDone++;
      checkBoth();
    });
    signal.attachRequestCompleted(() => {
      signalDone++;
      checkBoth();
    });

    json.loadData(MERGE_URL, undefined, undefined, undefined, true);
    signal.loadData(MERGE_URL, undefined, undefined, undefined, true);
  });

  // =========================================================================
  // Configuration modes with loadData
  // =========================================================================

  QUnit.test("loadData + autoCreatePaths: setProperty creates paths after load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      // After load, autoCreatePaths should still work for new paths
      const result = model.setProperty("/newSection/deep/value", "created");
      assert.ok(result, "autoCreatePaths creates path after loadData");
      assert.strictEqual(model.getProperty("/newSection/deep/value"), "created", "value set");
      // Loaded data still intact
      assert.strictEqual(model.getProperty("/name"), "Alice", "loaded data intact");
      model.destroy();
      done();
    });
  });

  QUnit.test("loadData + strictLeafCheck: rejects new leaves after load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({}, { strictLeafCheck: true });

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      // Existing leaf: allowed
      const r1 = model.setProperty("/name", "Bob");
      assert.ok(r1, "existing leaf accepted");
      assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");

      // New leaf on existing parent: rejected
      const r2 = model.setProperty("/newProp", "nope");
      assert.notOk(r2, "new leaf rejected by strictLeafCheck");

      model.destroy();
      done();
    });
  });

  // =========================================================================
  // Binding updates after loadData
  // =========================================================================

  QUnit.test("bindings update after loadData", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({ name: "placeholder" });
    const binding = model.bindProperty("/name");

    assert.strictEqual(binding.getValue(), "placeholder", "initial value");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Alice", "binding updated after loadData");
      model.destroy();
      done();
    });

    model.loadData(SAMPLE_URL);
  });

  // =========================================================================
  // Sequential loading (JSONModel parity: pSequentialImportCompleted)
  // =========================================================================

  QUnit.test(
    "multiple loadData calls execute sequentially -- last data wins (no merge)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel<Record<string, unknown>>();

      // Two loads: second overwrites first
      model.loadData(SAMPLE_URL);
      model.loadData(MERGE_URL);

      model.dataLoaded().then(() => {
        // merge.json contains { age: 30, customer: { ... } } -- sample.json's /name should be gone
        assert.strictEqual(model.getProperty("/age"), 30, "second load data present");
        assert.strictEqual(model.getProperty("/name"), undefined, "first load data overwritten");
        model.destroy();
        done();
      });
    },
  );

  QUnit.test("multiple loadData calls with merge -- data accumulates", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.loadData(SAMPLE_URL);
    model.loadData(MERGE_URL, undefined, undefined, undefined, true);

    model.dataLoaded().then(() => {
      // sample.json loads first (/name: "Alice"), then merge.json merges (/age: 30)
      assert.strictEqual(model.getProperty("/name"), "Alice", "first load data preserved");
      assert.strictEqual(model.getProperty("/age"), 30, "second load data merged");
      model.destroy();
      done();
    });
  });

  QUnit.test("dataLoaded resolves after all pending calls -- not just the last", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    let completedCount = 0;

    model.attachRequestCompleted(() => completedCount++);

    model.loadData(SAMPLE_URL);
    model.loadData(MERGE_URL);

    model.dataLoaded().then(() => {
      assert.strictEqual(completedCount, 2, "both requests completed before dataLoaded resolved");
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // Error handling -- event parameters
  // =========================================================================

  QUnit.test("requestFailed includes statusCode and statusText", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.attachRequestFailed((oEvent) => {
      const params = oEvent.getParameters();
      assert.ok(params.message, "error has message");
      assert.strictEqual(params.statusCode, 404, "statusCode is the HTTP status");
      assert.ok(params.statusText, "error has statusText");
      model.destroy();
      done();
    });

    model.loadData(BAD_URL);
  });

  QUnit.test("requestCompleted fires with success=false on error", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.attachRequestCompleted((oEvent) => {
      const params = oEvent.getParameters();
      assert.strictEqual(params.success, false, "success is false on error");
      assert.ok(params.errorobject, "error object present");
      model.destroy();
      done();
    });

    model.loadData(BAD_URL);
  });

  // =========================================================================
  // Error does not break the chain
  // =========================================================================

  QUnit.test("loadData after failed request still works", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    // First call fails
    model.loadData(BAD_URL);
    // Second call should succeed despite first failure
    model.loadData(SAMPLE_URL);

    model.dataLoaded().then(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "data loaded after failed request");
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // AbortSignal support (SignalModel extension)
  // =========================================================================

  QUnit.test("loadData supports AbortSignal to cancel request", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    const controller = new AbortController();

    model.attachRequestFailed(() => {
      assert.ok(true, "requestFailed fired for aborted request");
      model.destroy();
      done();
    });

    model.loadData(
      SAMPLE_URL,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    controller.abort();
  });

  // =========================================================================
  // Malformed JSON response
  // =========================================================================

  QUnit.test("loadData fires requestFailed for malformed JSON response", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.attachRequestFailed(() => {
      assert.ok(true, "requestFailed fired for malformed JSON");
      model.destroy();
      done();
    });

    model.loadData(MALFORMED_URL);
  });

  // =========================================================================
  // loadData after destroy
  // =========================================================================

  QUnit.test("loadData after destroy sends no request", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ name: "before" });
    model.destroy();

    const originalFetch = window.fetch;
    let calls = 0;
    window.fetch = (input, init) => {
      calls++;
      return originalFetch(input, init);
    };
    void model.loadData(SAMPLE_URL);
    window.fetch = originalFetch;

    assert.strictEqual(calls, 0, "no request sent for a destroyed model");
  });

  // =========================================================================
  // POST encoding parity with JSONModel
  // =========================================================================

  QUnit.test("POST with object params sends form-encoded body, not JSON", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    const params = { key: "value", num: "42" };

    // Intercept fetch to verify request format
    const origFetch = globalThis.fetch;
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      const req = init!;
      const body = req.body as string;
      const contentType = (req.headers as Record<string, string>)["Content-Type"] || "";

      assert.ok(
        contentType.startsWith("application/x-www-form-urlencoded"),
        `Content-Type is form-encoded (got: ${contentType})`,
      );
      assert.strictEqual(body, "key=value&num=42", "body is URL-encoded, not JSON");
      assert.notOk(body.startsWith("{"), "body is not JSON");

      globalThis.fetch = origFetch;
      model.destroy();
      done();
      // Return a resolved response so the model doesn't error
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    };

    model.loadData(SAMPLE_URL, params, undefined, "POST");
  });

  QUnit.test(
    "POST with string params sends body as-is with form-encoded Content-Type",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel<Record<string, unknown>>();
      const rawBody = "custom=body&foo=bar";

      const origFetch = globalThis.fetch;
      globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
        const req = init!;
        const body = req.body as string;
        const contentType = (req.headers as Record<string, string>)["Content-Type"] || "";

        assert.strictEqual(body, rawBody, "string body sent as-is");
        assert.ok(
          contentType.startsWith("application/x-www-form-urlencoded"),
          `Content-Type is form-encoded for string body (got: ${contentType})`,
        );

        globalThis.fetch = origFetch;
        model.destroy();
        done();
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      };

      model.loadData(SAMPLE_URL, rawBody, undefined, "POST");
    },
  );

  QUnit.test("GET with object params appends to URL, not body", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    const params = { q: "test", page: "1" };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      assert.ok(url.includes("q=test"), "query param q in URL");
      assert.ok(url.includes("page=1"), "query param page in URL");
      assert.strictEqual(init!.body, undefined, "GET has no body");

      globalThis.fetch = origFetch;
      model.destroy();
      done();
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    };

    model.loadData(SAMPLE_URL, params);
  });

  // =========================================================================
  // Cache-buster and destroy while loading (fetch stubbed to observe/control it)
  // =========================================================================

  QUnit.test("cache=false and forceNoCache append a cache-buster to the URL", (assert) => {
    const done = assert.async();
    const urls: string[] = [];
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      urls.push(String(input));
      return originalFetch(input, init);
    };
    const model = new SignalModel<Record<string, unknown>>();
    model.loadData(SAMPLE_URL);
    model.loadData(SAMPLE_URL, undefined, true, "GET", false, false);
    model.forceNoCache(true);
    model.loadData(SAMPLE_URL);
    window.fetch = originalFetch;

    assert.strictEqual(urls[0], SAMPLE_URL, "cached by default: URL untouched");
    assert.ok(/\?_=\d+$/.test(urls[1]), "cache=false appends a cache-buster: " + urls[1]);
    assert.ok(/\?_=\d+$/.test(urls[2]), "forceNoCache(true) appends a cache-buster: " + urls[2]);

    void model.dataLoaded().then(() => {
      model.destroy();
      done();
    });
  });

  QUnit.test("a response that is ready before destroy is not applied after it", (assert) => {
    const done = assert.async();
    const originalFetch = window.fetch;
    let calls = 0;
    // The first request stays pending until it is aborted; the second resolves at once
    // and then waits behind the first in the import chain.
    window.fetch = (_input, init) =>
      calls++ === 0
        ? new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
        : Promise.resolve(new Response(JSON.stringify({ name: "late" })));
    const model = new SignalModel<Record<string, unknown>>({ name: "before" });
    // destroy() detaches event listeners, so observe the fire call itself
    let failedFired = 0;
    model.fireRequestFailed = () => {
      failedFired++;
      return model;
    };
    model.loadData(SAMPLE_URL);
    let settled = false;
    void model.loadData(SAMPLE_URL)?.finally(() => (settled = true));
    window.fetch = originalFetch;

    setTimeout(() => {
      model.destroy(); // aborts the first request, which releases the second
      setTimeout(() => {
        assert.notOk(settled, "its promise stays pending, as JSONModel's after destroy");
        const data = model.getData() as Record<string, unknown> | undefined;
        assert.notStrictEqual(data?.name, "late", "queued response was not applied");
        assert.strictEqual(failedFired, 0, "aborted request fires no requestFailed after destroy");
        done();
      }, 50);
    }, 50);
  });

  QUnit.test(
    "loadData rejects with the error object on failure -- parity with JSONModel",
    async (assert) => {
      const outcome = async (
        model: JSONModel | SignalModel<Record<string, unknown>>,
        url = BAD_URL,
      ) => {
        let result: unknown = "resolved";
        await model.loadData(url)?.catch((error: unknown) => {
          result = error;
        });
        model.destroy();
        return result as { message: string; statusCode: number; statusText: string };
      };

      const json = await outcome(new JSONModel());
      const signal = await outcome(new SignalModel<Record<string, unknown>>());

      assert.strictEqual(
        json.statusCode,
        404,
        "JSONModel rejects with the HTTP status as a number",
      );
      assert.strictEqual(signal.statusCode, json.statusCode, "same statusCode");
      assert.strictEqual(signal.statusText, json.statusText, "same statusText");
      assert.strictEqual(signal.message, json.message, "same message");

      for (const [what, url] of [
        ["a response that is not JSON", MALFORMED_URL],
        ["no server", "http://localhost:1/none.json"],
      ]) {
        assert.deepEqual(
          await outcome(new SignalModel<Record<string, unknown>>(), url),
          await outcome(new JSONModel(), url),
          `same error object for ${what}`,
        );
      }
    },
  );

  QUnit.test("loadData with async = false loads synchronously, like JSONModel", (assert) => {
    for (const model of [new JSONModel(), new SignalModel<Record<string, unknown>>()]) {
      const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
      const events: string[] = [];
      model.attachRequestSent((event) => events.push(`sent async=${event.getParameter("async")}`));
      model.attachRequestCompleted((event) =>
        events.push(`completed success=${event.getParameter("success")}`),
      );
      model.attachRequestFailed((event) =>
        events.push(`failed ${event.getParameter("message")} ${event.getParameter("statusCode")}`),
      );

      const result: unknown = model.loadData(SAMPLE_URL, undefined, false);
      assert.strictEqual(result, undefined, `${name}: returns no promise`);
      assert.strictEqual(model.getProperty("/name"), "Alice", `${name}: data on the next line`);

      model.loadData(MERGE_URL, undefined, false, "GET", true);
      assert.strictEqual(
        `${model.getProperty("/name")}, ${model.getProperty("/age")}`,
        "Alice, 30",
        `${name}: merged`,
      );

      model.loadData(BAD_URL, undefined, false);
      model.loadData(MALFORMED_URL, undefined, false);
      assert.deepEqual(
        events,
        [
          "sent async=false",
          "completed success=true",
          "sent async=false",
          "completed success=true",
          "sent async=false",
          "completed success=false",
          "failed error 404",
          "sent async=false",
          "completed success=false",
          "failed parsererror 200",
        ],
        `${name}: events`,
      );
      model.destroy();
      assert.strictEqual(
        model.loadData(SAMPLE_URL, undefined, false) as unknown,
        undefined,
        `${name}: no promise after destroy either`,
      );
    }
  });

  QUnit.test("an empty status text is filled in as jQuery.ajax does", async (assert) => {
    // HTTP/2 has no status text; JSONModel then reports jQuery's own
    const originalFetch = window.fetch;
    const model = new SignalModel<Record<string, unknown>>({});
    const seen: unknown[] = [];
    model.attachRequestFailed((event) => seen.push(event.getParameter("statusText")));
    try {
      for (const [body, status, statusText] of [
        ["x", 500, ""],
        ["{", 200, ""],
        ["x", 404, "Not Found"],
      ] as const) {
        window.fetch = () => Promise.resolve(new Response(body, { status, statusText }));
        await model.loadData(SAMPLE_URL).catch(() => {});
      }
    } finally {
      window.fetch = originalFetch;
    }
    assert.deepEqual(seen, ["error", "parsererror", "Not Found"]);
    model.destroy();
  });

  QUnit.test("a response without content is a success without data", async (assert) => {
    const originalFetch = window.fetch;
    // 304: only seen by a request that sends its own If-None-Match
    for (const status of [204, 304]) {
      window.fetch = () => Promise.resolve(new Response(null, { status }));
      const model = new SignalModel<Record<string, unknown>>({ name: "old" });
      let completed: unknown;
      model.attachRequestCompleted((event) => (completed = event.getParameter("success")));
      try {
        await model.loadData(SAMPLE_URL);
      } finally {
        window.fetch = originalFetch;
      }
      assert.strictEqual(completed, true, `${status}: requestCompleted reports success`);
      assert.strictEqual(
        model.getData(),
        undefined,
        `${status}: the data is replaced by nothing, as in JSONModel`,
      );
      model.destroy();
    }
  });

  QUnit.test("JSONModel takes 204 and 304 as a success without data", (assert) => {
    const server = new MockServer({
      rootUri: "/mocked/",
      requests: [204, 304].map((status) => ({
        method: "GET",
        path: new RegExp(`status${status}`),
        response: (xhr: { respond(status: number, headers: object, body: string): void }) =>
          xhr.respond(status, {}, ""),
      })),
    });
    server.start();
    const results: string[] = [];
    try {
      for (const status of [204, 304]) {
        const model = new JSONModel({ name: "old" });
        model.attachRequestCompleted((event) =>
          results.push(`${status} success=${event.getParameter("success")}`),
        );
        model.loadData(`/mocked/status${status}`, undefined, false);
        results.push(String(model.getData()));
        model.destroy();
      }
    } finally {
      server.destroy();
    }
    assert.deepEqual(results, ["204 success=true", "undefined", "304 success=true", "undefined"]);
  });

  QUnit.test("an abort while the body is read is reported as abort", async (assert) => {
    const originalFetch = window.fetch;
    window.fetch = () =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        text: () => Promise.reject(new DOMException("Aborted", "AbortError")),
      } as Response);
    const model = new SignalModel<Record<string, unknown>>();
    let failure: { message?: string; statusCode?: number } = {};
    await model.loadData(SAMPLE_URL).catch((error: typeof failure) => (failure = error));
    window.fetch = originalFetch;
    assert.strictEqual(`${failure.message} ${failure.statusCode}`, "abort 0");
    model.destroy();
  });

  QUnit.test("a failed load does not block the next one", async (assert) => {
    let unhandled = 0;
    const onUnhandled = (): void => {
      unhandled++;
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const model = new SignalModel<Record<string, unknown>>();
    // Not awaited and without a catch: the model's import chain observes the rejection
    void model.loadData(BAD_URL);
    await model.loadData(SAMPLE_URL);
    assert.strictEqual(model.getProperty("/name"), "Alice", "next load applied");
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", onUnhandled);
    assert.strictEqual(unhandled, 0, "an ignored failed load is not an unhandled rejection");
    model.destroy();
  });

  QUnit.test("a custom accept header in any case replaces the default", (assert) => {
    const sent: (string | null)[] = [];
    const originalFetch = window.fetch;
    window.fetch = (_input, init) => {
      sent.push(new Headers(init?.headers).get("accept"));
      return Promise.resolve(new Response("{}"));
    };
    const model = new SignalModel<Record<string, unknown>>();
    void model.loadData(SAMPLE_URL);
    void model.loadData(SAMPLE_URL, undefined, true, "GET", false, true, { accept: "text/plain" });
    window.fetch = originalFetch;

    assert.deepEqual(
      sent,
      ["application/json", "text/plain"],
      "default, then the custom value alone",
    );
    model.destroy();
  });

  QUnit.test("the method in lower case and the cache-buster, as jQuery.ajax", async (assert) => {
    const requests: string[] = [];
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      requests.push(`${init?.method} ${String(input)} ${String(init?.body)}`);
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    };
    const model = new SignalModel<Record<string, unknown>>();
    try {
      await model.loadData(SAMPLE_URL, { q: "1" }, true, "get");
      await model.loadData(SAMPLE_URL, { q: "1" }, true, "post", false, false);
    } finally {
      window.fetch = originalFetch;
    }
    assert.deepEqual(requests, [`GET ${SAMPLE_URL}?q=1 undefined`, `POST ${SAMPLE_URL} q=1`]);
    model.destroy();
  });

  QUnit.test("a load that fails while an earlier one is loading", async (assert) => {
    let unhandled = 0;
    const onUnhandled = (): void => {
      unhandled++;
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const originalFetch = window.fetch;
    let release = (): void => {};
    window.fetch = (input, init) =>
      String(input) === SAMPLE_URL
        ? new Promise<void>((resolve) => (release = resolve)).then(() => originalFetch(input, init))
        : originalFetch(input, init);
    const model = new SignalModel<Record<string, unknown>>();
    void model.loadData(SAMPLE_URL);
    void model.loadData(BAD_URL);
    window.fetch = originalFetch;
    // The second request has failed by now, the first is still loading
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await model.dataLoaded();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", onUnhandled);
    assert.strictEqual(unhandled, 0, "no unhandled rejection");
    assert.strictEqual(model.getProperty("/name"), "Alice", "the first one applied");
    model.destroy();
  });

  QUnit.test(
    "the promise of a load stays pending after destroy, as JSONModel's",
    async (assert) => {
      const results: string[] = [];
      for (const Model of [JSONModel, SignalModel]) {
        const model = new Model();
        let settled = "pending";
        void (model.loadData(SAMPLE_URL) as Promise<unknown>).then(
          () => (settled = "resolved"),
          () => (settled = "rejected"),
        );
        model.destroy();
        await new Promise((resolve) => setTimeout(resolve, 300));
        results.push(settled);
      }
      assert.deepEqual(results, ["pending", "pending"]);
    },
  );

  QUnit.test(
    "MockServer sees a synchronous load, and an asynchronous one only of JSONModel",
    async (assert) => {
      const server = new MockServer({
        rootUri: "/mocked/",
        requests: [
          {
            method: "GET",
            path: /data\.json/,
            response: (xhr: { respondJSON(status: number, headers: object, body: object): void }) =>
              xhr.respondJSON(200, {}, { name: "mocked" }),
          },
        ],
      });
      server.start();
      const results: string[] = [];
      try {
        for (const model of [new JSONModel(), new SignalModel<Record<string, unknown>>()]) {
          model.loadData("/mocked/data.json", undefined, false);
          results.push(`sync ${String(model.getProperty("/name"))}`);
          model.setData({});
          await (model.loadData("/mocked/data.json") as Promise<unknown>).catch(() => {});
          results.push(`async ${String(model.getProperty("/name"))}`);
          model.destroy();
        }
      } finally {
        server.destroy();
      }
      assert.deepEqual(
        results,
        ["sync mocked", "async mocked", "sync mocked", "async undefined"],
        "SignalModel loads asynchronously with fetch: docs/jsonmodel-differences.md",
      );
    },
  );

  QUnit.test("HEAD carries its parameters in the URL, as GET", async (assert) => {
    const originalFetch = window.fetch;
    const calls: unknown[] = [];
    window.fetch = (url, init) => {
      calls.push([url, init?.method, init?.body]);
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    const model = new SignalModel();
    try {
      await model.loadData("/x.json", { a: "1" }, true, "HEAD");
    } finally {
      window.fetch = originalFetch;
    }
    assert.deepEqual(calls, [["/x.json?a=1", "HEAD", undefined]]);
    model.destroy();
  });

  QUnit.test("an abort with a reason is reported as an abort", async (assert) => {
    const model = new SignalModel();
    const controller = new AbortController();
    const expected = {
      message: "abort",
      statusCode: 0,
      statusText: "abort",
      responseText: undefined,
    };
    let failed: unknown;
    model.attachRequestFailed((event) => (failed = event.getParameters()));
    const loaded = model.loadData(
      SAMPLE_URL,
      undefined,
      true,
      "GET",
      false,
      true,
      undefined,
      controller.signal,
    );
    controller.abort("reason");
    await loaded.then(
      () => assert.ok(false, "must reject"),
      (error: unknown) => assert.deepEqual(error, expected),
    );
    assert.deepEqual(failed, expected);
    model.destroy();
  });

  QUnit.test(
    "destroy() in a requestSent handler: no error, the promise stays pending",
    async (assert) => {
      const model = new SignalModel();
      model.attachRequestSent(() => model.destroy());
      const loaded = model.loadData(SAMPLE_URL);
      const state = await Promise.race([
        loaded.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
      ]);
      assert.strictEqual(state, "pending", "as JSONModel");
      const sync = new SignalModel();
      sync.attachRequestSent(() => sync.destroy());
      assert.strictEqual(sync.loadData(SAMPLE_URL, undefined, false), undefined);
    },
  );

  QUnit.test("a synchronous load with an aborted signal makes no request", (assert) => {
    const model = new SignalModel({ old: true });
    const events: string[] = [];
    model.attachRequestCompleted((event) =>
      events.push(`completed ${event.getParameter("success")}`),
    );
    model.attachRequestFailed((event) => events.push(`failed ${event.getParameter("message")}`));
    const controller = new AbortController();
    controller.abort();
    model.loadData(SAMPLE_URL, undefined, false, "GET", false, true, undefined, controller.signal);
    assert.deepEqual(events, ["completed false", "failed abort"]);
    assert.deepEqual(model.getData(), { old: true }, "the data stays");
    model.destroy();
  });

  QUnit.test("a synchronous load: an error of a handler is not a failed request", (assert) => {
    // A request that passes the errors of its listeners on, as a fake XMLHttpRequest can
    class PassingOn {
      status = 200;
      statusText = "OK";
      responseText = '{"a":1}';
      private listener?: () => void;
      addEventListener(_type: string, listener: () => void): void {
        this.listener = listener;
      }
      open(): void {}
      setRequestHeader(): void {}
      send(): void {
        this.listener?.();
      }
    }
    const original = window.XMLHttpRequest;
    window.XMLHttpRequest = PassingOn as unknown as typeof XMLHttpRequest;
    const model = new SignalModel();
    const events: string[] = [];
    model.attachRequestCompleted((event) => {
      events.push(`completed ${event.getParameter("success")}`);
      throw new Error("handler");
    });
    model.attachRequestFailed(() => events.push("failed"));
    try {
      model.loadData(SAMPLE_URL, undefined, false);
    } finally {
      window.XMLHttpRequest = original;
    }
    assert.deepEqual(events, ["completed true"], "no second requestCompleted, no requestFailed");
    assert.deepEqual(model.getData(), { a: 1 });
    model.destroy();
  });
});
