//! 2D affine math and layer bounds.

use crate::model::Transform;

/// `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    /// `self · other` — apply `other` first, then `self`.
    pub fn then_after(&self, other: &Affine) -> Affine {
        Affine {
            a: self.a * other.a + self.c * other.b,
            b: self.b * other.a + self.d * other.b,
            c: self.a * other.c + self.c * other.d,
            d: self.b * other.c + self.d * other.d,
            e: self.a * other.e + self.c * other.f + self.e,
            f: self.b * other.e + self.d * other.f + self.f,
        }
    }

    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }

    /// Linear part only (for deltas and handle offsets).
    pub fn apply_vec(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y, self.b * x + self.d * y)
    }

    pub fn det(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    pub fn invert(&self) -> Option<Affine> {
        let det = self.det();
        if !det.is_finite() || det.abs() < 1e-12 {
            return None;
        }
        let ia = self.d / det;
        let ib = -self.b / det;
        let ic = -self.c / det;
        let id = self.a / det;
        Some(Affine {
            a: ia,
            b: ib,
            c: ic,
            d: id,
            e: -(ia * self.e + ic * self.f),
            f: -(ib * self.e + id * self.f),
        })
    }

    pub fn is_identity(&self) -> bool {
        *self == Affine::IDENTITY
    }

    /// Mean linear scale, used for stroke widths under transform.
    pub fn mean_scale(&self) -> f64 {
        self.det().abs().sqrt()
    }
}

impl Transform {
    pub fn affine(&self) -> Affine {
        if self.is_identity() {
            return Affine::IDENTITY;
        }
        let (s, c) = self.rotation.to_radians().sin_cos();
        // A = R·S
        let a = c * self.sx;
        let b = s * self.sx;
        let cc = -s * self.sy;
        let d = c * self.sy;
        // t + o - A·o
        let e = self.tx + self.ox - (a * self.ox + cc * self.oy);
        let f = self.ty + self.oy - (b * self.ox + d * self.oy);
        Affine { a, b, c: cc, d, e, f }
    }
}

/// Axis-aligned rectangle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn right(&self) -> f64 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }
    pub fn union(&self, o: &Rect) -> Rect {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect { x, y, w: self.right().max(o.right()) - x, h: self.bottom().max(o.bottom()) - y }
    }
    pub fn from_points(pts: &[(f64, f64)]) -> Option<Rect> {
        let mut it = pts.iter();
        let first = it.next()?;
        let (mut x0, mut y0, mut x1, mut y1) = (first.0, first.1, first.0, first.1);
        for p in it {
            x0 = x0.min(p.0);
            y0 = y0.min(p.1);
            x1 = x1.max(p.0);
            y1 = y1.max(p.1);
        }
        Some(Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
    pub fn corners(&self) -> [(f64, f64); 4] {
        [
            (self.x, self.y),
            (self.right(), self.y),
            (self.right(), self.bottom()),
            (self.x, self.bottom()),
        ]
    }
    /// Transform the rect's corners; returns the corners and their AABB.
    pub fn transformed(&self, m: &Affine) -> ([(f64, f64); 4], Rect) {
        let c = self.corners().map(|(x, y)| m.apply(x, y));
        let bb = Rect::from_points(&c).unwrap_or(*self);
        (c, bb)
    }
}
