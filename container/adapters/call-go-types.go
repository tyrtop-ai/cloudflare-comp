// The named types a Go file (its path on stdin) declares at package level, one per line, as
// Go's own parser reads it (call-native.mjs): the Go call driver refers to
// each, so reflect can find the one that implements an interface parameter.
// A generic type, which no reference names without type arguments, and an
// alias are left out.
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
)

func main() {
	name, _ := io.ReadAll(os.Stdin)
	f, err := parser.ParseFile(token.NewFileSet(), string(name), nil, parser.SkipObjectResolution)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, d := range f.Decls {
		if g, ok := d.(*ast.GenDecl); ok && g.Tok == token.TYPE {
			for _, s := range g.Specs {
				if t := s.(*ast.TypeSpec); t.TypeParams == nil && !t.Assign.IsValid() && t.Name.Name != "_" {
					fmt.Println(t.Name.Name)
				}
			}
		}
	}
}
