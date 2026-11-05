//! Owned-heap estimates for engine documents.
//!
//! `heap_size()` reports bytes a value owns on the heap, excluding
//! `size_of::<Self>()` itself. It reads capacities and lengths only, so it
//! never allocates and never formats. Collections count their reserved
//! capacity, because that is what the allocator actually holds.
//!
//! These are estimates for GC pressure (Hermes external memory), not an
//! allocator audit: B-tree node overhead and allocator rounding are
//! approximated.
//!
//! All arithmetic saturates. Engines compute this inside the per-document
//! lock, where a panic closes the document, so an overflowing sum on a 32-bit
//! target must report `usize::MAX` rather than panic or wrap.

use std::collections::BTreeMap;
use std::mem::size_of;

pub trait HeapSize {
    /// True when no value of this type owns heap memory, so collections can
    /// charge capacity alone instead of visiting every element.
    const FLAT: bool = false;

    fn heap_size(&self) -> usize;
}

/// Saturating sum, for adding up per-entry estimates.
pub fn saturating_sum(values: impl IntoIterator<Item = usize>) -> usize {
    values.into_iter().fold(0, usize::saturating_add)
}

macro_rules! no_heap {
    ($($t:ty),* $(,)?) => {
        $(impl HeapSize for $t {
            const FLAT: bool = true;

            #[inline]
            fn heap_size(&self) -> usize { 0 }
        })*
    };
}

no_heap!(bool, u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64, char);

impl<T: HeapSize, const N: usize> HeapSize for [T; N] {
    const FLAT: bool = T::FLAT;

    fn heap_size(&self) -> usize {
        if T::FLAT {
            return 0;
        }
        saturating_sum(self.iter().map(HeapSize::heap_size))
    }
}

impl HeapSize for String {
    #[inline]
    fn heap_size(&self) -> usize {
        self.capacity()
    }
}

impl<T: HeapSize> HeapSize for Vec<T> {
    fn heap_size(&self) -> usize {
        let reserved = self.capacity().saturating_mul(size_of::<T>());
        if T::FLAT {
            return reserved;
        }
        reserved.saturating_add(saturating_sum(self.iter().map(HeapSize::heap_size)))
    }
}

impl<T: HeapSize> HeapSize for Option<T> {
    fn heap_size(&self) -> usize {
        self.as_ref().map_or(0, HeapSize::heap_size)
    }
}

impl<T: HeapSize> HeapSize for Box<T> {
    fn heap_size(&self) -> usize {
        size_of::<T>().saturating_add((**self).heap_size())
    }
}

/// B-tree leaves hold up to 11 entries plus a parent pointer and lengths;
/// charge one machine word per entry on top of the key/value bytes.
impl<K: HeapSize, V: HeapSize> HeapSize for BTreeMap<K, V> {
    fn heap_size(&self) -> usize {
        let entries = self
            .len()
            .saturating_mul(size_of::<K>() + size_of::<V>() + size_of::<usize>());
        if K::FLAT && V::FLAT {
            return entries;
        }
        entries.saturating_add(saturating_sum(
            self.iter()
                .map(|(k, v)| k.heap_size().saturating_add(v.heap_size())),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_and_vectors_count_capacity() {
        let s = String::with_capacity(40);
        assert_eq!(s.heap_size(), 40);
        let v: Vec<u64> = Vec::with_capacity(8);
        assert_eq!(v.heap_size(), 64);
        let nested = vec![String::from("abcd")];
        assert_eq!(
            nested.heap_size(),
            nested.capacity() * size_of::<String>() + nested[0].capacity()
        );
    }

    #[test]
    fn empty_values_own_nothing() {
        assert_eq!(String::new().heap_size(), 0);
        assert_eq!(Vec::<u8>::new().heap_size(), 0);
        assert_eq!(None::<String>.heap_size(), 0);
        assert_eq!(BTreeMap::<u64, u64>::new().heap_size(), 0);
    }

    #[test]
    fn flat_vectors_charge_capacity_without_walking() {
        assert!(u8::FLAT && <[u8; 4]>::FLAT && !String::FLAT);
        let bytes = vec![7u8; 4096];
        assert_eq!(bytes.heap_size(), bytes.capacity());
    }

    #[test]
    fn sums_saturate_instead_of_overflowing() {
        assert_eq!(saturating_sum([usize::MAX, 1]), usize::MAX);
        assert_eq!(saturating_sum([2, 3]), 5);
    }

    #[test]
    fn map_counts_entries_and_owned_values() {
        let mut map = BTreeMap::new();
        map.insert(String::from("A1"), String::from("42"));
        assert!(map.heap_size() >= 4 + size_of::<String>() * 2);
    }
}
