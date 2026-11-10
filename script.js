// =====================================================
// NEOVR — Conta de usuário com Supabase Auth
// =====================================================

const SUPABASE_URL = "https://baqhdvxdvbnoqqzdjnrv.supabase.co";
const SUPABASE_KEY = "sb_publishable_2_N8nuLKFJEUBe_SImhJtQ_VpKrKR5Z";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Captura o ?ref= da URL e guarda por 30 dias
(function guardarRef() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) localStorage.setItem("neovr_ref", ref.trim().toUpperCase());
})();

// ---------- CONFIGURE AQUI O SEU PIX ----------
const PIX_TIPO  = "E-mail";                 // CPF, CNPJ, E-mail, Telefone ou Aleatória
const PIX_CHAVE = "SUA-CHAVE-PIX-AQUI";
const PIX_NOME  = "NOME DO FAVORECIDO";

const PIX_ESPERA = 25;   // segundos até liberar o envio do comprovante

const brl = (n) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------- Elementos da página ----------
const $ = (id) => document.getElementById(id);

const modal        = $("accountModal");
const openLoginBtn = $("openLogin");
const closeBtn     = $("closeAccount");

const title        = $("accountTitle");
const description  = $("accountDescription");
const message      = $("accountMessage");

const loginForm    = $("loginForm");
const signupForm   = $("signupForm");
const loggedArea   = $("loggedArea");
const userWelcome  = $("userWelcome");

const showSignup   = $("showSignup");
const showLogin    = $("showLogin");
const logoutBtn    = $("logoutButton");

const userBalance  = $("userBalance");
const orderList    = $("orderList");

const payModal     = $("payModal");
const payForm      = $("payForm");
const payMessage   = $("payMessage");
let   planoAtual   = null;
let   meuRefCode   = "";   // guarda o código de convite do usuário logado

// ---------- Utilidades ----------
function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.style.color = isError ? "#ff8a9b" : "var(--cyan)";
}

function setBusy(form, busy) {
  const btn = form.querySelector("button[type=submit]");
  if (btn) btn.disabled = busy;
}

function openModal() {
  modal.classList.add("open");
}

function closeModal() {
  modal.classList.remove("open");
  setMessage("");
}

// Mostra apenas uma das telas: "login", "signup" ou "logged"
function showView(view, user = null) {
  loginForm.hidden  = view !== "login";
  signupForm.hidden = view !== "signup";
  loggedArea.hidden = view !== "logged";

  if (view === "login") {
    title.textContent = "Entrar na NEOVR";
    description.textContent = "Acesse sua conta.";
  } else if (view === "signup") {
    title.textContent = "Criar conta";
    description.textContent = "Preencha os dados para se cadastrar.";
  } else if (view === "logged") {
    const nome = user?.user_metadata?.nome || user?.email || "";
    title.textContent = "Minha conta";
    description.textContent = "";
    userWelcome.textContent = `Você está conectado como ${nome} (${user?.email}).`;
    if (user) carregarConta(user);
  }

  setMessage("");
}

function traduzirErro(error) {
  const msg = (error?.message || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("email not confirmed"))       return "Confirme seu e-mail antes de entrar (veja sua caixa de entrada).";
  if (msg.includes("already registered"))        return "Este e-mail já está cadastrado.";
  if (msg.includes("password"))                  return "Senha inválida. Use no mínimo 8 caracteres.";
  if (msg.includes("rate limit"))                return "Muitas tentativas. Aguarde um pouco e tente de novo.";
  return error?.message || "Ocorreu um erro. Tente novamente.";
}

// ---------- Saldo e pedidos da conta ----------
const fmtData = (iso) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

let avisoTimer;
function mostrarAviso(texto) {
  const el = $("toast");
  if (!el) return alert(texto);
  el.textContent = texto;
  el.classList.add("show");
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove("show"), 6000);
}

function textoBloqueio(s) {
  if (s.motivo === "pendente")
    return "Você já enviou um comprovante que está em análise. Aguarde a aprovação para comprar de novo.";

  if (s.motivo === "espera")
    return `Você só poderá comprar outra cota a partir de ${fmtData(s.libera_em)} (48h após a aprovação) e depois de realizar o saque da cota atual.`;

  if (s.motivo === "saque")
    return "Já passaram as 48h. Para comprar outra cota, primeiro solicite o saque da cota atual na sua conta.";

  return "Faça login para comprar as cotas.";
}

function renderProgressoSaque(pv) {
  const box = $("withdrawProgress");
  if (!box) return;
  box.replaceChildren();
  if (!pv) return;

  const disponivel = Number(pv.pago) || 0;
  const aguardando = Number(pv.aguardando ?? pv.bloqueado ?? 0) || 0;
  const vip        = !!pv.vip || !!pv.isento_convite;
  const livre      = Number(pv.livre_sem_convite) || 0;
  const liberaEm   = pv.libera_em ? new Date(pv.libera_em) : null;

  // Barra de cooldown (48h)
  if (aguardando > 0 && liberaEm) {
    const totalMs    = 48 * 3600 * 1000;
    const restanteMs = Math.max(0, liberaEm.getTime() - Date.now());
    const pct        = Math.min(100, ((totalMs - restanteMs) / totalMs) * 100);
    const horasRest  = Math.max(0, Math.ceil(restanteMs / 3600000));
    const pronto     = restanteMs <= 0;

    const block = document.createElement("div");
    block.className = "progress-block" + (pronto ? " done" : "");
    block.innerHTML = `
      <div class="progress-label">
        <span>⏱ Liberação de ${brl(aguardando)} (48h)</span>
        <strong>${pronto ? "Liberado" : horasRest + "h restantes"}</strong>
      </div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
    `;
    box.appendChild(block);
  }

  // Resumo
  const resumo = document.createElement("div");
  resumo.className = "progress-resumo";

  if (disponivel <= 0 && aguardando <= 0) {
    resumo.textContent = "Sem valor aprovado ainda.";
  } else if (disponivel <= 0) {
    resumo.textContent = "Assim que o prazo de 48h terminar, o valor fica disponível.";
  } else if (!vip && livre > 0 && disponivel <= livre) {
    resumo.innerHTML = `✅ Você pode sacar <strong>${brl(disponivel)}</strong> agora (cota básica — sem convidar).`;
  } else {
    resumo.innerHTML = `Disponível para saque: <strong>${brl(disponivel)}</strong> — clique em <strong>Saque</strong> para ver o que falta.`;
  }
  box.appendChild(resumo);
}

async function carregarConta(user) {
  userBalance.textContent = "...";
  orderList.replaceChildren();
  $("buyStatus").textContent = "";

  // Credita o bônus de quem já passou das 48h (se houver) antes de mostrar o saldo
  await supabaseClient.rpc("liberar_dobro");

  const [perfil, pedidos, reembolsos, compra, indicados, saqueInfo] = await Promise.all([
  supabaseClient.from("profiles").select("saldo, referral_code").eq("id", user.id).maybeSingle(),
  supabaseClient.from("pedidos")
    .select("plano, valor, status, created_at, analisado_em, bonus_aplicado")
    .order("created_at", { ascending: false })
    .limit(20),
  supabaseClient.from("reembolsos")
    .select("valor, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10),
  supabaseClient.rpc("status_compra"),
  supabaseClient.rpc("indicados_aprovados"),
  supabaseClient.rpc("previa_saque"),
]);

userBalance.textContent = brl(perfil.data?.saldo ?? 0);

// Guarda o código de convite (será usado no modal de saque)
meuRefCode = perfil.data?.referral_code || "";

renderProgressoSaque(saqueInfo.data);

  const st = compra.data;
  if (st) {
    $("buyStatus").textContent = st.bloqueado
      ? textoBloqueio(st)
      : "Compra liberada: você já pode comprar créditos.";
  }
  const promoAtiva = !!st?.promo_ativa;

  // junta pedidos e reembolsos numa lista só, do mais novo para o mais antigo
  const itens = [];

  (pedidos.data || []).forEach((p) => {
    let rotulo = { pendente: "Aguardando", aprovado: "Aprovado", rejeitado: "Rejeitado" }[p.status] || p.status;

    if (p.status === "aprovado" && p.bonus_aplicado) {
      rotulo = "Aprovado · saldo dobrado";
    } else if (p.status === "aprovado" && promoAtiva && p.analisado_em) {
      const horas = Math.max(1, Math.ceil(
        (new Date(p.analisado_em).getTime() + 48 * 3600 * 1000 - Date.now()) / 3600000
      ));
      rotulo = `Aprovado · saldo dobra em ~${horas}h`;
    }

    itens.push({
      data: p.created_at,
      texto: `${p.plano} — ${brl(p.valor)} (${new Date(p.created_at).toLocaleDateString("pt-BR")})`,
      classe: p.status,
      rotulo,
    });
  });

  (reembolsos.data || []).forEach((r) => {
  itens.push({
    data: r.created_at,
    texto: `Saque — ${brl(r.valor)} (${new Date(r.created_at).toLocaleDateString("pt-BR")})`,
    classe: { pendente: "pendente", pago: "aprovado", rejeitado: "rejeitado" }[r.status],
    rotulo: { pendente: "Saque em análise", pago: "Saque enviado", rejeitado: "Saque recusado" }[r.status],
  });
});

  itens.sort((x, y) => new Date(y.data) - new Date(x.data));

  if (itens.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhum pedido ainda.";
    orderList.appendChild(li);
    return;
  }

  itens.forEach((it) => {
    const li = document.createElement("li");

    const esquerda = document.createElement("span");
    esquerda.textContent = it.texto;

    const direita = document.createElement("span");
    direita.className = `status ${it.classe}`;
    direita.textContent = it.rotulo;

    li.append(esquerda, direita);
    orderList.appendChild(li);
  });
}

// ---------- Abrir / fechar modal ----------
openLoginBtn.addEventListener("click", async () => {
  const { data } = await supabaseClient.auth.getSession();
  const user = data.session?.user;

  if (user) showView("logged", user);
  else showView("login");

  openModal();
});

closeBtn.addEventListener("click", closeModal);

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    fecharPagamento();
    fecharReembolso();
  }
});

// Botão "Copiar" do link de convite dentro do modal de saque
$("copyRefundRef")?.addEventListener("click", async () => {
  const texto = $("refundReferralLink")?.textContent || "";
  if (!texto || texto === "—") return;

  try {
    await navigator.clipboard.writeText(texto);
    const btn = $("copyRefundRef");
    btn.textContent = "Copiado!";
    setTimeout(() => (btn.textContent = "Copiar"), 1500);
  } catch {
    alert("Copie manualmente:\n" + texto);
  }
});

// ---------- Alternar login / cadastro ----------
showSignup.addEventListener("click", (e) => {
  e.preventDefault();
  showView("signup");
});

showLogin.addEventListener("click", (e) => {
  e.preventDefault();
  showView("login");
});

// ---------- Criar conta ----------
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome  = $("signupName").value.trim();
  const email = $("signupEmail").value.trim().toLowerCase();
  const senha = $("signupPassword").value;

  if (senha.length < 8) {
    setMessage("A senha precisa ter no mínimo 8 caracteres.", true);
    return;
  }

  setBusy(signupForm, true);
  setMessage("Criando sua conta...");

  const refSalvo = localStorage.getItem("neovr_ref") || "";

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: senha,
    options: { data: { nome, ref_code: refSalvo } },
  });

  setBusy(signupForm, false);

  if (error) {
    setMessage(traduzirErro(error), true);
    return;
  }

  localStorage.removeItem("neovr_ref");

  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    setMessage("Este e-mail já está cadastrado. Faça login.", true);
    return;
  }

  if (data.session) {
    signupForm.reset();
    showView("logged", data.user);
    setMessage("Conta criada com sucesso!");
  } else {
    signupForm.reset();
    showView("login");
    setMessage("Conta criada! Confirme seu e-mail e depois faça login.");
  }
});

// ---------- Login ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = $("loginEmail").value.trim().toLowerCase();
  const senha = $("loginPassword").value;

  setBusy(loginForm, true);
  setMessage("Entrando...");

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  setBusy(loginForm, false);

  if (error) {
    setMessage(traduzirErro(error), true);
    return;
  }

  loginForm.reset();
  showView("logged", data.user);
  setMessage("Login realizado!");
});

// ---------- Sair ----------
logoutBtn.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    setMessage(traduzirErro(error), true);
    return;
  }

  showView("login");
  setMessage("Você saiu da conta.");
});

// ---------- Pagamento por Pix ----------
function setPayMessage(text, isError = false) {
  payMessage.textContent = text || "";
  payMessage.style.color = isError ? "#ff8a9b" : "var(--cyan)";
}

function abrirPagamento(plano, valorTexto) {
  planoAtual = { nome: plano, texto: valorTexto };

  $("payPlan").textContent = plano;
  $("payValue").textContent = valorTexto;
  $("pixType").textContent = PIX_TIPO;
  $("pixKey").textContent = PIX_CHAVE;
  $("pixName").textContent = PIX_NOME;

  payForm.reset();
  setPayMessage("");
  travarComprovante();
  payModal.classList.add("open");
}

function fecharPagamento() {
  payModal.classList.remove("open");
  setPayMessage("");
  travarComprovante();
}

// ---------- Trava de 25s depois de copiar a chave ----------
let timerPix = null;

function travarComprovante() {
  clearInterval(timerPix);
  timerPix = null;

  $("payFields").disabled = true;
  $("payLock").textContent =
    `🔒 Copie a chave Pix e faça o pagamento no seu banco. O envio do comprovante é liberado ${PIX_ESPERA} segundos depois de copiar.`;
  $("copyPix").textContent = "Copiar chave Pix";
  $("copyPix").disabled = false;
}

function iniciarEspera() {
  // já está contando, ou já liberou: não reinicia
  if (timerPix || !$("payFields").disabled) return;

  let restante = PIX_ESPERA;

  const atualizar = () => {
    $("payLock").textContent =
      `⏳ Faça o pagamento no seu banco. O envio do comprovante libera em ${restante}s...`;
    $("copyPix").textContent = `Chave copiada — libera em ${restante}s`;
    $("copyPix").disabled = true;
  };

  atualizar();

  timerPix = setInterval(() => {
    restante--;
    if (restante > 0) return atualizar();

    clearInterval(timerPix);
    timerPix = null;
    $("payFields").disabled = false;
    $("payLock").textContent = "✅ Liberado! Anexe o comprovante do Pix e envie.";
    $("copyPix").textContent = "Copiar chave Pix novamente";
    $("copyPix").disabled = false;
  }, 1000);
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // plano B para navegadores/páginas sem permissão de área de transferência
    const t = document.createElement("textarea");
    t.value = texto;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    t.remove();
    return ok;
  }
}

document.querySelectorAll(".buy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (!data.session) {
      showView("login");
      openModal();
      setMessage("Entre ou crie uma conta para comprar créditos.");
      return;
    }

    const { data: st, error } = await supabaseClient.rpc("status_compra");

    if (error) {
      showView("logged", data.session.user);
      openModal();
      setMessage("Não foi possível verificar sua compra: " + error.message, true);
      return;
    }

    if (st.bloqueado) {
      mostrarAviso(textoBloqueio(st));
      return;
    }

    abrirPagamento(btn.dataset.plan, btn.dataset.value);
  });
});

$("closePay").addEventListener("click", fecharPagamento);
payModal.addEventListener("click", (e) => {
  if (e.target === payModal) fecharPagamento();
});

$("copyPix").addEventListener("click", async () => {
  const ok = await copiarTexto(PIX_CHAVE);

  setPayMessage(
    ok ? "Chave Pix copiada! Cole no app do seu banco."
       : "Não consegui copiar. Selecione a chave acima e copie manualmente.",
    !ok
  );

  iniciarEspera();   // a contagem começa mesmo se o copiar automático falhar
});

payForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const arquivo = $("payFile").files[0];
  const tiposOk = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

  if (!arquivo) return setPayMessage("Anexe o comprovante.", true);
  if (!tiposOk.includes(arquivo.type)) return setPayMessage("Envie uma imagem (PNG, JPG, WEBP) ou PDF.", true);
  if (arquivo.size > 5 * 1024 * 1024) return setPayMessage("O arquivo passa de 5 MB.", true);

  const { data } = await supabaseClient.auth.getSession();
  const user = data.session?.user;
  if (!user) return setPayMessage("Sua sessão expirou. Entre novamente.", true);

  // "R$ 25,00" -> 25
  const valor = parseFloat(planoAtual.texto.replace(/[^\d,]/g, "").replace(",", "."));

  setBusy(payForm, true);
  setPayMessage("Enviando comprovante...");

  const ext  = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[arquivo.type];
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const up = await supabaseClient.storage.from("comprovantes").upload(path, arquivo, { contentType: arquivo.type });
  if (up.error) {
    setBusy(payForm, false);
    return setPayMessage("Falha ao enviar o arquivo: " + up.error.message, true);
  }

  const ins = await supabaseClient.from("pedidos").insert({
    user_id: user.id,
    plano: planoAtual.nome,
    valor,
    comprovante_path: path,
  });

  setBusy(payForm, false);

  if (ins.error) {
    await supabaseClient.storage.from("comprovantes").remove([path]);
    return setPayMessage("Não foi possível registrar o pedido: " + ins.error.message, true);
  }

  payForm.reset();
  $("payFields").disabled = true;
  $("payLock").textContent = "✅ Comprovante enviado.";
  setPayMessage("Comprovante enviado! Assim que confirmarmos o Pix, o saldo aparece na sua conta.");
});

// ---------- Reembolso ----------
const refundModal = $("refundModal");
const refundForm  = $("refundForm");

function setRefundMessage(text, isError = false) {
  $("refundMessage").textContent = text || "";
  $("refundMessage").style.color = isError ? "#ff8a9b" : "var(--cyan)";
}

function fecharReembolso() {
  refundModal.classList.remove("open");
  setRefundMessage("");
}

$("openRefund").addEventListener("click", async () => {
  const { data } = await supabaseClient.auth.getSession();

  if (!data.session) {
    showView("login");
    openModal();
    setMessage("Entre na sua conta para pedir saque.");
    return;
  }

  refundForm.reset();
  $("refundFields").disabled = true;
  $("refundValue").textContent = "...";
  setRefundMessage("");
  $("refundConvites").hidden = true;       // esconde o bloco de convites por padrão
  refundModal.classList.add("open");

  const { data: pv, error } = await supabaseClient.rpc("previa_saque");
  if (error) {
    setRefundMessage("Não foi possível carregar seus dados: " + error.message, true);
    return;
  }

  $("refundValue").textContent = brl(pv.pago);

  const bloqueado = Number(pv.aguardando ?? pv.bloqueado ?? 0) || 0;
  const livre     = Number(pv.livre_sem_convite ?? 0) || 0;
  const indicados = Number(pv.indicados ?? 0) || 0;
  const minInd    = Number(pv.min_indicados ?? 3) || 3;
  const pago      = Number(pv.pago ?? 0) || 0;
  const vip       = !!pv.vip || !!pv.isento_convite;

  // 1) Já tem saque em análise
  if (pv.em_andamento) {
    setRefundMessage("Você já tem um saque em análise.", true);
    return;
  }

  // 2) Sem valor disponível
  if (pago <= 0) {
    setRefundMessage(
      bloqueado > 0
        ? `Seu valor de ${brl(bloqueado)} só fica disponível após 48h da aprovação.`
        : "Você não tem valor disponível para saque.",
      true
    );
    return;
  }

  // 3) VIP ou já tem convites → libera direto
  if (vip || indicados >= minInd) {
    setRefundMessage(`✅ Saque liberado: ${brl(pago)}.`, false);
    $("refundFields").disabled = false;
    return;
  }

  // 4) Cota básica cobre tudo → libera sem convites
  if (pago <= livre) {
    setRefundMessage(`✅ Cota básica: você pode sacar ${brl(pago)} sem precisar convidar.`, false);
    $("refundFields").disabled = false;
    return;
  }

  // 5) Faltam convites → mostra link + barra + explica
  $("refundConvites").hidden = false;

  const link = meuRefCode
    ? `${location.origin}${location.pathname}?ref=${meuRefCode}`
    : "—";
  $("refundReferralLink").textContent = link;
  $("convitesCount").textContent = `${indicados}/${minInd}`;
  $("convitesBar").style.width = `${Math.min(100, (indicados / minInd) * 100)}%`;

  setRefundMessage(
    livre > 0
      ? `Você pode sacar até ${brl(livre)} sem convidar (cota básica). Para sacar ${brl(pago)}, faltam ${minInd - indicados} indicação(ões).`
      : `Faltam ${minInd - indicados} indicação(ões) com depósito aprovado para liberar o saque.`,
    true
  );
});

$("closeRefund").addEventListener("click", fecharReembolso);
refundModal.addEventListener("click", (e) => {
  if (e.target === refundModal) fecharReembolso();
});

refundForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const chave = $("refundKey").value.trim();

  const ok = confirm(
    `Sacar ${$("refundValue").textContent} para a chave Pix:\n\n${chave}\n\nConfirmar?`
  );
  if (!ok) return;

  setBusy(refundForm, true);
  setRefundMessage("Enviando pedido...");

  const { error } = await supabaseClient.rpc("solicitar_saque", { p_chave: chave });

  setBusy(refundForm, false);

  if (error) {
    setRefundMessage(error.message, true);
    return;
  }

  refundForm.reset();
  $("refundFields").disabled = true;
  setRefundMessage('Pedido enviado! Quando fizermos o Pix, o status muda para "saque enviado" em Minha conta.');
});

// ---------- Sessão persistente ----------
function atualizarBotaoNav(user) {
  openLoginBtn.textContent = user ? "Minha conta" : "Entrar";
  $("openRefund").hidden = !user;   // botão Reembolso só aparece logado
}

// Ao carregar a página, recupera a sessão salva
supabaseClient.auth.getSession().then(({ data }) => {
  atualizarBotaoNav(data.session?.user);
});

// Reage a login, logout e renovação de sessão
supabaseClient.auth.onAuthStateChange((_event, session) => {
  atualizarBotaoNav(session?.user);
});

console.log("NEOVR conectada ao Supabase!");

// MODAL DE TERMOS E CONDIÇÕES

const termsModal = document.getElementById("termsModal");

document.getElementById("openTerms").addEventListener("click", () => {
  termsModal.classList.add("open");
});

document.getElementById("closeTerms").addEventListener("click", () => {
  termsModal.classList.remove("open");
});

document.getElementById("closeTermsBottom").addEventListener("click", () => {
  termsModal.classList.remove("open");
});

termsModal.addEventListener("click", (event) => {
  if (event.target === termsModal) {
    termsModal.classList.remove("open");
  }
});