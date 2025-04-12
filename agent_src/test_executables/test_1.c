#include <stdio.h>
#include <string.h> // For strcpy

void cause_crash(char *input) {
    char buffer[10];
    // Intentional buffer overflow leading to crash
    strcpy(buffer, input);
    printf("Buffer content: %s\n", buffer); // Might not reach here
}

int main() {
    printf("Starting program...\n");
    char *bad_input = "This input is definitely too long for the small buffer";
    cause_crash(bad_input);
    printf("Program finished normally?!\n"); // Should not reach here
    return 0;
}