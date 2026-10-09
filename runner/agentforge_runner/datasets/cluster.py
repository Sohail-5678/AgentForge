"""Agglomerative clustering (average linkage, cosine distance) in numpy — deterministic, no extra dependencies."""

from __future__ import annotations

import numpy as np


def cosine_matrix(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    unit = x / np.where(norms == 0, 1, norms)
    return np.clip(unit @ unit.T, -1.0, 1.0)


def agglomerative(x: np.ndarray, *, threshold: float = 0.6) -> list[list[int]]:
    """Merge the closest clusters while their average cosine distance is below `threshold`.

    Returns clusters (lists of row indices), largest first, ties by first index.
    """
    n = len(x)
    if n == 0:
        return []
    dist = 1.0 - cosine_matrix(x)
    np.fill_diagonal(dist, np.inf)
    members: dict[int, list[int]] = {i: [i] for i in range(n)}
    active = np.ones(n, dtype=bool)
    while active.sum() > 1:
        masked = np.where(active[:, None] & active[None, :], dist, np.inf)
        flat = int(np.argmin(masked))
        i, j = divmod(flat, n)
        if not np.isfinite(masked[i, j]) or masked[i, j] > threshold:
            break
        i, j = min(i, j), max(i, j)
        ni, nj = len(members[i]), len(members[j])
        # Lance–Williams update for average linkage.
        dist[i, :] = (ni * dist[i, :] + nj * dist[j, :]) / (ni + nj)
        dist[:, i] = dist[i, :]
        dist[i, i] = np.inf
        members[i] += members.pop(j)
        active[j] = False
        dist[j, :] = np.inf
        dist[:, j] = np.inf
    clusters = [sorted(m) for m in members.values()]
    return sorted(clusters, key=lambda c: (-len(c), c[0]))


def medoid(x: np.ndarray, idx: list[int]) -> int:
    sub = cosine_matrix(x[idx])
    return idx[int(np.argmax(sub.sum(axis=1)))]
