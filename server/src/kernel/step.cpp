#include <BRep_Builder.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS_Compound.hxx>
#include <unistd.h>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <mutex>
#include <string>
#include <system_error>
#include <vector>

#include "guarded.hpp"
#include "operations.hpp"

// Export to STEP (spec 06 "Export STEP v adaptéru (M15)"; step.ts in TS). STEPControl_Writer
// writes to a file (as in the WASM build), here a temporary file of the real file system.

namespace tinycad::kernel::detail {

namespace {

/**
 * A unique path in the temporary directory, removed when the object goes out of scope: after a
 * failed Transfer or Write too (RAII instead of the finally of step.ts).
 */
class TemporaryFile {
 public:
  TemporaryFile() {
    static std::atomic<unsigned long> counter{0};
    path_ =
        std::filesystem::temp_directory_path() / ("tinycad-export-" + std::to_string(::getpid()) +
                                                  "-" + std::to_string(++counter) + ".step");
  }
  ~TemporaryFile() {
    std::error_code ignored;
    std::filesystem::remove(path_, ignored);
  }
  TemporaryFile(const TemporaryFile&) = delete;
  TemporaryFile& operator=(const TemporaryFile&) = delete;

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }

 private:
  std::filesystem::path path_;
};

/** One shape as it is, several as a compound in their order. */
TopoDS_Shape shapeToWrite(const std::vector<const ShapeEntry*>& entries) {
  if (entries.size() == 1) return entries.front()->shape();
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (const ShapeEntry* entry : entries) builder.Add(compound, entry->shape());
  return compound;
}

/**
 * Serializes every STEP export of the process (N106, spec 14 "Vlákna a zámky serveru"): the STEP
 * translator keeps process-wide state – the static parameters of Interface_Static
 * (write.step.schema, write.step.unit) and the shared protocol and session of the XSControl
 * library – that is not thread safe, so two sessions exporting at once could corrupt each other.
 * One export at a time is cheap compared to that; other kernel calls do not take it.
 */
std::mutex& stepMutex() {
  static std::mutex mutex;
  return mutex;
}

/** STEPControl_Writer: AP214 and mm are the defaults of write.step.schema and write.step.unit. */
// The info messages of the translator (transfer statistics) go to the process-wide messenger,
// which tinycad-core quiets once at start (N78, src/app/main.cpp).
void writeFile(const TopoDS_Shape& shape, const std::filesystem::path& path) {
  const std::scoped_lock lock(stepMutex());
  try {
    STEPControl_Writer writer;
    const IFSelect_ReturnStatus transferred = writer.Transfer(shape, STEPControl_AsIs);
    if (transferred != IFSelect_RetDone) {
      fail(KernelErrorCode::OperationFailed,
           "exportStep: Transfer gave " + std::to_string(static_cast<int>(transferred)));
    }
    const IFSelect_ReturnStatus written = writer.Write(path.c_str());
    if (written != IFSelect_RetDone) {
      fail(KernelErrorCode::OperationFailed,
           "exportStep: Write gave " + std::to_string(static_cast<int>(written)));
    }
  } catch (const Standard_Failure& e) {
    fail(KernelErrorCode::OperationFailed,
         std::string("exportStep: ") + e.ExceptionType() + ": " + e.what());
  }
}

std::string readFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) fail(KernelErrorCode::OperationFailed, "exportStep: cannot read the written file");
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

}  // namespace

std::string exportStepOf(const ShapeTable& shapes, std::span<const ShapeHandle> handles) {
  if (handles.empty()) fail(KernelErrorCode::InvalidInput, "exportStep: shapes must not be empty");
  if (!allDistinct(handles))
    fail(KernelErrorCode::InvalidInput, "exportStep: the same handle twice");
  std::vector<const ShapeEntry*> entries;
  for (const ShapeHandle h : handles) entries.push_back(&shapes.find(h));
  const TemporaryFile file;
  writeFile(shapeToWrite(entries), file.path());
  return readFile(file.path());
}

}  // namespace tinycad::kernel::detail
