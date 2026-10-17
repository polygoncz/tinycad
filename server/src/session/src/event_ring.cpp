// Stub of M45 task 1; implemented by task 2.
#include "tinycad/session/event_ring.hpp"

#include "not_implemented.hpp"

namespace tinycad::session {

EventRing::EventRing(std::size_t capacity) : capacity_(capacity) {}

std::uint64_t EventRing::append(tinycad::v1::SessionEvent /*event*/) {
  throwNotImplemented("EventRing::append");
}

std::uint64_t EventRing::lastSeq() const { throwNotImplemented("EventRing::lastSeq"); }

std::optional<std::vector<tinycad::v1::SessionEvent>> EventRing::after(
    std::uint64_t /*afterSeq*/) const {
  throwNotImplemented("EventRing::after");
}

std::optional<std::vector<tinycad::v1::SessionEvent>> EventRing::waitAfter(
    std::uint64_t /*afterSeq*/, std::chrono::steady_clock::time_point /*deadline*/) const {
  throwNotImplemented("EventRing::waitAfter");
}

void EventRing::close() { throwNotImplemented("EventRing::close"); }

bool EventRing::closed() const { throwNotImplemented("EventRing::closed"); }

}  // namespace tinycad::session
