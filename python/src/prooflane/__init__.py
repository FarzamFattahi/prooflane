"""Deterministic local image comparison for review and CI."""

from .engine import Comparison, Rect, Region, compare_images

__all__ = ["Comparison", "Rect", "Region", "compare_images"]
__version__ = "1.0.0"
