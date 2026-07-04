// Spectral analysis of the chain. The symmetrized transition matrix
// S = D^{-1/2} A D^{-1/2} is real-symmetric, so it diagonalizes with a Jacobi
// rotation sweep. Its eigenpairs are the chain's normal modes: each eigenvalue
// becomes a sustained pad tone that decays at rate lazyLambda(l)^t. Ported once
// from mixing-time-composer.html lines 118-148 / 161-184 / 311-317 (an
// identical jacobi copy lives in convergence-suite.html).

import type { Graph } from "./graph.js";

/** One eigenvalue `l` with its unit eigenvector `v`. */
export type Eigenpair = { l: number; v: number[] };

/**
 * Symmetric normalization S[i][j] = A[i][j] / (sqrtDeg[i] * sqrtDeg[j]).
 * S shares eigenvalues with the random-walk matrix M = D^{-1}A but, unlike M,
 * is symmetric — so it has real eigenvalues and an orthonormal eigenbasis.
 */
export function symmetrizedMatrix(g: Graph): Float64Array[] {
  const { n, A, sqrtDeg } = g;
  const S = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) S[i][j] = A[i][j] / (sqrtDeg[i] * sqrtDeg[j]);
  }
  return S;
}

/**
 * Classical Jacobi eigensolver for a real-symmetric matrix. Returns eigenpairs
 * sorted by eigenvalue descending (so `eig[0]` is the stationary direction,
 * l ~= 1). Direct port of mixing-time-composer.html lines 119-148: 120 sweeps,
 * off-diagonal-sum stop at 1e-14, per-element skip at 1e-13.
 */
export function jacobi(Sin: Float64Array[]): Eigenpair[] {
  const n = Sin.length;
  const A = Sin.map((r) => Float64Array.from(r));
  const V = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) V[i][i] = 1;

  for (let sweep = 0; sweep < 120; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-13) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const vals: Eigenpair[] = [];
  for (let i = 0; i < n; i++) vals.push({ l: A[i][i], v: V.map((r) => r[i]) });
  vals.sort((a, b) => b.l - a.l);
  return vals;
}

/**
 * Eigenvalue of the lazy walk `alpha*I + (1-alpha)*M`. Laziness shifts
 * eigenVALUES only — the eigenVECTORS are unchanged — which is why the
 * prototype can rescale the spectrum live without re-diagonalizing.
 */
export function lazyLambda(l: number, alpha: number): number {
  return alpha + (1 - alpha) * l;
}

/**
 * Project the current distribution onto each eigenmode. With z[i] = x[i]/sqrtDeg[i],
 * the coefficient of mode k is dot(z, v_k). Mode 0 is the stationary direction;
 * the rest are the transient pad voices. Port of lines 179-184.
 */
export function modeCoeffs(x: Float64Array, g: Graph, eig: Eigenpair[]): number[] {
  const { n, sqrtDeg } = g;
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = x[i] / sqrtDeg[i];
  return eig.map((e) => {
    let c = 0;
    for (let i = 0; i < n; i++) c += z[i] * e.v[i];
    return c;
  });
}

/**
 * Estimate mixing time from the spectral gap. Uses the second-largest
 * |lazyLambda| (the slowest transient mode): ceil(log(4*sqrt(n)) / -log(lmax)),
 * at least 1. Returns Infinity when lmax >= 0.99999 (the chain is effectively
 * non-ergodic). Port of lines 311-317.
 */
export function estimateMixingTime(eig: Eigenpair[], alpha: number, n: number): number {
  let lmax = 0;
  for (let k = 1; k < eig.length; k++) {
    lmax = Math.max(lmax, Math.abs(lazyLambda(eig[k].l, alpha)));
  }
  if (lmax >= 0.99999) return Infinity;
  return Math.max(1, Math.ceil(Math.log(4 * Math.sqrt(n)) / -Math.log(lmax)));
}
