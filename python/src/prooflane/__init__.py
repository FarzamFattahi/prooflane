"""Deterministic local image comparison for review and CI."""

from .engine import Comparison, Rect, Region, compare_images
from .api import ImageInput, compare, load_image, render_difference, save_report

__all__ = ["Comparison", "Rect", "Region", "compare_images", "ImageInput", "compare",
           "load_image", "render_difference", "save_report"]
__version__ = "1.1.0"
