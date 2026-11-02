import type { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  calculatePlatformFeeLamports,
  formatLamportsAsSol,
  parseSolToLamports,
} from "./fees";

const MAINNET_RPC =
  import.meta.env.VITE_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const PUMP_MAINNET_ALT = "7mFD2mUtRS65XstiSAvCJuYmdesZoQwCwRJhq1p3eRMe";
const PLATFORM_FEE_RECIPIENT = "DXMj13Ni2kioTLCvfBgyLro2ZrFwfuiug6pz1bhHNU3G";
const CREATE_COMPUTE_UNITS = 270_000;
const CREATE_AND_BUY_COMPUTE_UNITS = 390_000;
const PRIORITY_FEE_MICRO_LAMPORTS = 100_000;

interface WalletProvider {
  publicKey?: PublicKey;
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(
    transaction: VersionedTransaction,
    options?: { preflightCommitment?: "confirmed" },
  ): Promise<{ signature: string }>;
  on?(event: "accountChanged", callback: (publicKey: PublicKey | null) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: WalletProvider };
  }
}

interface LaunchDetails {
  name: string;
  symbol: string;
  uri: string;
  initialBuyLamports: bigint;
  platformFeeLamports: bigint;
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Launchpad page is missing ${selector}.`);
  }
  return element;
}

const form = getElement<HTMLFormElement>("#launch-form");
const nameInput = getElement<HTMLInputElement>("#token-name");
const symbolInput = getElement<HTMLInputElement>("#token-symbol");
const metadataInput = getElement<HTMLInputElement>("#metadata-uri");
const initialBuyInput = getElement<HTMLInputElement>("#initial-buy");
const feePreview = getElement<HTMLElement>("#fee-preview");
const connectButton = getElement<HTMLButtonElement>("#connect-wallet");
const reviewButton = getElement<HTMLButtonElement>("#review-launch");
const walletStatus = getElement<HTMLElement>("#wallet-status");
const launchStatus = getElement<HTMLElement>("#launch-status");
const dialog = getElement<HTMLDialogElement>("#review-dialog");
const reviewSummary = getElement<HTMLElement>("#review-summary");
const cancelReviewButton = getElement<HTMLButtonElement>("#cancel-review");
const confirmLaunchButton = getElement<HTMLButtonElement>("#confirm-launch");

let connectedWallet: WalletProvider | null = null;
let connectedCreator: PublicKey | null = null;
let reviewedLaunch: LaunchDetails | null = null;
let isSubmitting = false;

function setStatus(message: string, isError = false): void {
  launchStatus.textContent = message;
  launchStatus.classList.toggle("error", isError);
}

function getProvider(): WalletProvider | null {
  const provider = window.phantom?.solana;
  return provider?.isPhantom ? provider : null;
}

function getLaunchDetails(): LaunchDetails {
  const name = nameInput.value.trim();
  const symbol = symbolInput.value.trim();
  const uri = metadataInput.value.trim();
  const parsedUri = new URL(uri);

  if (parsedUri.protocol !== "https:") {
    throw new Error("Metadata URL must use HTTPS.");
  }

  const initialBuyLamports = parseSolToLamports(initialBuyInput.value);
  return {
    name,
    symbol,
    uri,
    initialBuyLamports,
    platformFeeLamports: calculatePlatformFeeLamports(initialBuyLamports),
  };
}

function updateFeePreview(): void {
  try {
    const buyLamports = parseSolToLamports(initialBuyInput.value || "0");
    feePreview.textContent = formatLamportsAsSol(calculatePlatformFeeLamports(buyLamports));
    initialBuyInput.setCustomValidity("");
  } catch (error) {
    feePreview.textContent = "—";
    initialBuyInput.setCustomValidity(
      error instanceof Error ? error.message : "Invalid SOL amount.",
    );
  }
}

function renderReview(details: LaunchDetails): void {
  const estimatedPriorityLamports =
    BigInt(details.initialBuyLamports > 0n ? CREATE_AND_BUY_COMPUTE_UNITS : CREATE_COMPUTE_UNITS) *
    BigInt(PRIORITY_FEE_MICRO_LAMPORTS) /
    1_000_000n;

  const rows = [
    ["Network", "Solana mainnet"],
    ["Token", `${details.name} (${details.symbol})`],
    ["Metadata", details.uri],
    ["Initial buy", formatLamportsAsSol(details.initialBuyLamports)],
    ["Platform fee (0.5%)", formatLamportsAsSol(details.platformFeeLamports)],
    ["Fee recipient", PLATFORM_FEE_RECIPIENT],
    ["Priority fee target", `about ${formatLamportsAsSol(estimatedPriorityLamports)}`],
  ];

  reviewSummary.replaceChildren();
  rows.forEach(([label, value]) => {
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    const content = document.createElement("span");
    content.textContent = value;
    row.append(strong, content);
    reviewSummary.append(row);
  });
  const extraCosts = document.createElement("p");
  extraCosts.textContent =
    "Account rent and final network costs are additional and may vary. Review the complete transaction in Phantom.";
  reviewSummary.append(extraCosts);
}

async function connectWallet(): Promise<void> {
  const provider = getProvider();
  if (!provider) {
    walletStatus.innerHTML =
      'Phantom was not detected. <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Install Phantom</a>, then return to this page.';
    return;
  }

  try {
    const { publicKey } = await provider.connect();
    connectedWallet = provider;
    connectedCreator = publicKey;
    walletStatus.textContent = `Connected: ${publicKey.toBase58()}`;
    reviewButton.disabled = false;
    connectButton.textContent = "Phantom connected";
    connectButton.disabled = true;
    provider.on?.("accountChanged", (nextPublicKey) => {
      if (!nextPublicKey) {
        connectedWallet = null;
        connectedCreator = null;
        reviewButton.disabled = true;
        connectButton.textContent = "Connect Phantom";
        connectButton.disabled = false;
        walletStatus.textContent = "Wallet disconnected. Connect Phantom to continue.";
        return;
      }
      connectedCreator = nextPublicKey;
      walletStatus.textContent = `Connected: ${nextPublicKey.toBase58()}`;
    });
    setStatus("");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet connection failed.";
    walletStatus.textContent = `Could not connect Phantom: ${message}`;
  }
}

async function launch(details: LaunchDetails): Promise<void> {
  const wallet = connectedWallet;
  const creator = connectedCreator;
  if (!wallet || !creator) {
    setStatus("Connect Phantom again before continuing.", true);
    return;
  }
  if (isSubmitting) {
    return;
  }
  isSubmitting = true;
  confirmLaunchButton.disabled = true;
  connectButton.disabled = true;
  setStatus("Preparing the mainnet transaction…");

  try {
    const [
      { default: BN },
      {
        ComputeBudgetProgram,
        Connection,
        Keypair,
        PublicKey,
        SystemProgram,
        TransactionMessage,
        VersionedTransaction,
      },
      { NATIVE_MINT },
      { getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK },
    ] = await Promise.all([
      import("bn.js"),
      import("@solana/web3.js"),
      import("@solana/spl-token"),
      import("@pump-fun/pump-sdk"),
    ]);
    const connection = new Connection(MAINNET_RPC, "confirmed");
    const pumpMainnetAlt = new PublicKey(PUMP_MAINNET_ALT);
    const platformFeeRecipient = new PublicKey(PLATFORM_FEE_RECIPIENT);
    const latestCreator = getProvider()?.publicKey;
    if (!latestCreator || !latestCreator.equals(creator)) {
      throw new Error("The connected wallet changed. Reconnect and review the launch again.");
    }

    const mintKeypair = Keypair.generate();
    const generatedInstructions =
      details.initialBuyLamports > 0n
        ? await (async () => {
            const onlineSdk = new OnlinePumpSdk(connection);
            const [global, feeConfig] = await Promise.all([
              onlineSdk.fetchGlobal(),
              onlineSdk.fetchFeeConfig(),
            ]);
            const solAmount = new BN(details.initialBuyLamports.toString());
            const amount = getBuyTokenAmountFromSolAmount({
              global,
              feeConfig,
              mintSupply: null,
              bondingCurve: null,
              amount: solAmount,
              quoteMint: NATIVE_MINT,
            });
            return PUMP_SDK.createV2AndBuyInstructions({
              global,
              mint: mintKeypair.publicKey,
              name: details.name,
              symbol: details.symbol,
              uri: details.uri,
              creator,
              user: creator,
              amount,
              solAmount,
              mayhemMode: false,
              cashback: false,
            });
          })()
        : await PUMP_SDK.createV2Instruction({
            mint: mintKeypair.publicKey,
            name: details.name,
            symbol: details.symbol,
            uri: details.uri,
            creator,
            user: creator,
            mayhemMode: false,
          });
    const instructions = Array.isArray(generatedInstructions)
      ? generatedInstructions
      : [generatedInstructions];

    if (details.platformFeeLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: creator,
          toPubkey: platformFeeRecipient,
          lamports: Number(details.platformFeeLamports),
        }),
      );
    }

    const lookupTableResponse = await connection.getAddressLookupTable(pumpMainnetAlt);
    if (!lookupTableResponse.value) {
      throw new Error("Pump’s mainnet address lookup table could not be loaded; no transaction was sent.");
    }

    const computeUnits =
      details.initialBuyLamports > 0n ? CREATE_AND_BUY_COMPUTE_UNITS : CREATE_COMPUTE_UNITS;
    const completeInstructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
      }),
      ...instructions,
    ];
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: creator,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: completeInstructions,
      }).compileToV0Message([lookupTableResponse.value]),
    );
    transaction.sign([mintKeypair]);

    const currentCreator = getProvider()?.publicKey;
    if (!currentCreator || !currentCreator.equals(creator)) {
      throw new Error("The connected wallet changed. No transaction was sent; review the launch again.");
    }

    setStatus("Review the transaction details in Phantom. Nothing is sent until you approve it.");
    const result = await wallet.signAndSendTransaction(transaction, {
      preflightCommitment: "confirmed",
    });
    const signature = result.signature;
    const explorerUrl = `https://solscan.io/tx/${encodeURIComponent(signature)}`;

    setStatus("");
    const sentMessage = document.createElement("p");
    sentMessage.textContent = `Submitted. Token mint: ${mintKeypair.publicKey.toBase58()}. `;
    const transactionLink = document.createElement("a");
    transactionLink.href = explorerUrl;
    transactionLink.target = "_blank";
    transactionLink.rel = "noreferrer";
    transactionLink.textContent = "View transaction";
    sentMessage.append(transactionLink);
    launchStatus.append(sentMessage);

    try {
      const confirmation = await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed",
      );
      if (confirmation.value.err) {
        setStatus(
          "The network reported that the transaction failed. Check the transaction details before retrying.",
          true,
        );
        return;
      }
      const successMessage = document.createElement("p");
      successMessage.textContent = "Confirmed on Solana mainnet.";
      launchStatus.append(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Confirmation could not be checked.";
      const pendingMessage = document.createElement("p");
      pendingMessage.textContent = `Confirmation could not be checked: ${message}. Use the transaction link above before retrying.`;
      launchStatus.append(pendingMessage);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch could not be completed.";
    setStatus(`Launch stopped: ${message}`, true);
  } finally {
    isSubmitting = false;
    confirmLaunchButton.disabled = false;
    connectButton.disabled = connectedWallet !== null;
  }
}

initialBuyInput.addEventListener("input", updateFeePreview);
connectButton.addEventListener("click", () => void connectWallet());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus("");
  if (!connectedWallet) {
    setStatus("Connect Phantom before reviewing the launch.", true);
    return;
  }

  try {
    reviewedLaunch = getLaunchDetails();
    renderReview(reviewedLaunch);
    dialog.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check the launch details.";
    setStatus(message, true);
  }
});
cancelReviewButton.addEventListener("click", () => {
  reviewedLaunch = null;
  dialog.close();
});
confirmLaunchButton.addEventListener("click", () => {
  if (!reviewedLaunch) {
    setStatus("Review the launch details before continuing.", true);
    return;
  }
  dialog.close();
  void launch(reviewedLaunch);
});

updateFeePreview();
