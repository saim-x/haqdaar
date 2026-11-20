"""Argon2id password hashing (docs/09 §1.1). Plaintext is never stored or logged."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# Argon2id is argon2-cffi's default type; parameters are the library defaults
# (time_cost=3, memory_cost=64 MiB, parallelism=4) which are appropriate here.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password or not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


__all__ = ["hash_password", "needs_rehash", "verify_password"]
