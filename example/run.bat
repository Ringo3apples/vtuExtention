@echo off

start /wait "" gmsh "coil.geo" -2 -o "coil.msh"
ElmerGrid 14 2 "coil.msh" -out "coil" -autoclean

ElmerSolver "static.sif"
ElmerSolver "alternative.sif"
ElmerSolver "transient.sif"
