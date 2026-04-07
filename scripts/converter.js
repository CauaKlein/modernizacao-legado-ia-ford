const runButton = document.getElementById("conv-run");
const clearButton = document.getElementById("conv-clear");
const msgBox = document.getElementById("conv-msg");
const legacyInput = document.getElementById("conv-legacy");
const refactoredOutput = document.getElementById("conv-refactored");
const fromLang = document.getElementById("conv-lang");
const toLang = document.getElementById("conv-target");

runButton.addEventListener("click", async () => {
  const legacyCode = legacyInput.value.trim();
  if (!legacyCode) {
    msgBox.textContent = "Digite um código para refatorar!";
    return;
  }

  msgBox.textContent = "Enviando código para a IA...";
  refactoredOutput.value = "";
  runButton.disabled = true;

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_lang: fromLang.value,
        to_lang: toLang.value,
        source_code: legacyCode,
      }),
    });

    let data;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const txt = await response.text();
      data = { raw: txt };
    }

    if (!response.ok) {
      const errMsg = data?.error || data?.message || `HTTP ${response.status}`;
      msgBox.textContent = "Erro: " + errMsg;
      console.error("Resposta não OK:", data);
      refactoredOutput.value = JSON.stringify(data, null, 2);
    } else {
      msgBox.textContent = "Código convertido com sucesso!";
      let out = data.refactored ?? null;
      if (!out) {
        if (data.raw) {
          if (data.raw.text) out = data.raw.text;
          else if (Array.isArray(data.raw.candidates) && data.raw.candidates[0]) {
            const c = data.raw.candidates[0];
            if (c.content && Array.isArray(c.content.parts)) {
              out = c.content.parts.map(p => p.text || "").join("\n");
            } else if (c.content?.text) {
              out = c.content.text;
            } else {
              out = JSON.stringify(c, null, 2);
            }
          } else {
            out = typeof data.raw === "string" ? data.raw : JSON.stringify(data.raw, null, 2);
          }
        } else {
          out = JSON.stringify(data, null, 2);
        }
      }
      refactoredOutput.value = out;
      console.log("endpoint_used:", data.endpoint_used ?? "N/A");
    }
  } catch (err) {
    msgBox.textContent = "Erro ao conectar com o servidor.";
    console.error("Erro fetch /api/convert:", err);
  } finally {
    runButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  legacyInput.value = "";
  refactoredOutput.value = "";
  msgBox.textContent = "";
});
