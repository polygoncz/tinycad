#ifndef BASE_H
#define BASE_H

// tinycad patch (see ../../README.md): the Salusoft89 original logs through emscripten (EM_JS,
// console.log); the native build writes the same messages to stderr. planegcs logs only in a debug
// mode, which the tinycad adapter never turns on.

#include <stdio.h>
#include <stdarg.h>

class Console {
public:
    static void Log(const char* format, ...) {
        va_list args;
        va_start(args, format);
        vfprintf(stderr, format, args);
        va_end(args);
    }
};


#endif // BASE_H
