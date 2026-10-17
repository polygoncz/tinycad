/**************************************************************************************************
* This library provides WebAssembly bindings for the FreeCAD's geometric solver library planegcs. *
* Copyright (C) 2023  Miroslav Šerý, Salusoft89 <miroslav.sery@salusoft89.cz>                     *
* Copyright (C) 2023  Jiří Hon, Salusoft89 <jiri.hon@salusoft89.cz>                               *
*                                                                                                 *
* This library is free software; you can redistribute it and/or                                   *
* modify it under the terms of the GNU Lesser General Public                                      *
* License as published by the Free Software Foundation; either                                    *
* version 2.1 of the License, or (at your option) any later version.                              *
*                                                                                                 *
* This library is distributed in the hope that it will be useful,                                 *
* but WITHOUT ANY WARRANTY; without even the implied warranty of                                  *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU                               *
* Lesser General Public License for more details.                                                 *
*                                                                                                 *
* You should have received a copy of the GNU Lesser General Public                                *
* License along with this library; if not, write to the Free Software                             *
* Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA                    *
**************************************************************************************************/

// tinycad: the class GcsSystem of Salusoft89/planegcs 1.3.0 rendered by hand from
// ../templates/gcs_system.cpp.njk and ../templates/add_constraint_functions.cpp.njk for a native
// build (see ../README.md): the same members and bodies, without emscripten (EM_ASM, the Embind
// bindings) and with only the add_constraint_* functions the tinycad adapter calls, each exactly
// as the template generates it from GCS.h. The parameter `scale` of the generated functions is
// left out: the wrapper always passes 1, and with 1 the function never rescales.

#ifndef TINYCAD_PLANEGCS_GCS_SYSTEM_H
#define TINYCAD_PLANEGCS_GCS_SYSTEM_H

#include <stdexcept>
#include <vector>
#include "GCS.h"

namespace planegcs {

using namespace GCS;
using std::vector;

class GcsSystem : System
{
    public:
        vector<double *> p_params;
        vector<bool> is_fixed;

        GcsSystem() : System() {
            p_params = vector<double *>();
            is_fixed = vector<bool>();
        }

        int params_size()
        {
            return p_params.size();
        }

        double get_p_param(int i)
        {
            return *p_params[i];
        }

        void set_p_param(int i, double value, bool fixed)
        {
            *p_params[i] = value;
            is_fixed[i] = fixed;
        }

        int push_p_param(double value, bool fixed)
        {
            int index = p_params.size();
            p_params.push_back(new double(value));
            is_fixed.push_back(fixed);
            return index;
        }

        bool get_is_fixed(int i)
        {
            return is_fixed[i];
        }

        void set_max_iterations(int n) {
            maxIter = n;
        }

        int get_max_iterations() {
            return maxIter;
        }

        void set_covergence_threshold(double threshold) {
            convergence = threshold;
        }

        double get_convergence_threshold() {
            return convergence;
        }

        // an integer is used here because Enum didn't work properly
        int solve_system(int algorithm)
        {
            Algorithm alg = static_cast<Algorithm>(algorithm);
            vector<double *> solved_p_params;
            for (int i = 0; i < p_params.size(); ++i)
            {
                if (!is_fixed[i])
                {
                    solved_p_params.push_back(p_params[i]);
                }
            }

            // the second parameter doesn't influence anything
            return solve(solved_p_params, true, alg);
        }

        vector<double> get_p_params()
        {
            vector<double> p;
            for (int i = 0; i < p_params.size(); ++i)
            {
                p.push_back(*p_params[i]);
            }
            return p;
        }

        void clear_data()
        {
            for (int i = 0; i < p_params.size(); ++i)
            {
                delete p_params[i];
            }
            p_params.clear();
            is_fixed.clear();
            clear();
        }

        void apply_solution()
        {
            applySolution();
        }

        int dof()
        {
            return dofsNumber();
        }

        bool has_conflicting()
        {
            return hasConflicting();
        }

        bool has_redundant()
        {
            return hasRedundant();
        }

        bool has_partially_redundant()
        {
            return hasPartiallyRedundant();
        }

        vector<int> get_conflicting()
        {
            vector<int> conflicting;
            getConflicting(conflicting);
            return conflicting;
        }

        vector<int> get_redundant()
        {
            vector<int> redundant;
            getRedundant(redundant);
            return redundant;
        }

        vector<int> get_partially_redundant()
        {
            vector<int> partially_redundant;
            getPartiallyRedundant(partially_redundant);
            return partially_redundant;
        }

        void clear_by_id(int id)
        {
            clearByTag(id);
        }

        void set_debug_mode(int debug_mode)
        {
            DebugMode debug_mode_enum = static_cast<DebugMode>(debug_mode);
            this->debugMode = debug_mode_enum;
        }

        int get_debug_mode()
        {
            return this->debugMode;
        }

        /* make objects from params */
        Point make_point(int px_i, int py_i)
        {
            Point p;
            p.x = p_param_or_fail(px_i);
            p.y = p_param_or_fail(py_i);
            return p;
        }

        Line make_line(int p1x_i, int p1y_i, int p2x_i, int p2y_i)
        {
            Point p1 = make_point(p1x_i, p1y_i);
            Point p2 = make_point(p2x_i, p2y_i);

            Line l;
            l.p1 = p1;
            l.p2 = p2;

            return l;
        }

        Circle make_circle(int cx_i, int cy_i, int rad_i)
        {
            Point cp = make_point(cx_i, cy_i);

            Circle c;
            c.center = cp;
            c.rad = p_param_or_fail(rad_i);

            return c;
        }

        Arc make_arc(
            int cx_i, int cy_i, int startx_i, int starty_i, int endx_i, int endy_i,
            int startangle_i, int endangle_i, int rad_i)
        {
            Point c = make_point(cx_i, cy_i);
            Point start = make_point(startx_i, starty_i);
            Point end = make_point(endx_i, endy_i);

            Arc a;
            a.center = c;
            a.start = start;
            a.startAngle = p_param_or_fail(startangle_i);
            a.endAngle = p_param_or_fail(endangle_i);
            a.end = end;
            a.rad = p_param_or_fail(rad_i);

            return a;
        }

        BSpline make_bspline(
            int startx_i, int starty_i, int endx_i, int endy_i, vector<int> poles_xy_i,
            vector<int> weights_i, vector<int> knots_i, vector<int> mult, int degree, bool periodic
        )
        {
            BSpline bs;
            bs.start = make_point(startx_i, starty_i);
            bs.end = make_point(endx_i, endy_i);
            bs.degree = degree;
            bs.periodic = periodic;
            bs.mult = mult;

            for (int i = 0; i < poles_xy_i.size(); i += 2) {
                Point p = make_point(poles_xy_i[i], poles_xy_i[i + 1]);
                bs.poles.push_back(p);
            }

            for (int i = 0; i < weights_i.size(); i++) {
                bs.weights.push_back(p_param_or_fail(weights_i[i]));
            }

            for (int i = 0; i < knots_i.size(); i++) {
                bs.knots.push_back(p_param_or_fail(knots_i[i]));
            }

            return bs;
        }

        /* the add_constraint_* functions of the template that the tinycad adapter uses */
        void add_constraint_difference(int param1, int param2, int difference, int tagId, bool driving) {
            addConstraintDifference(p_param_or_fail(param1), p_param_or_fail(param2), p_param_or_fail(difference), tagId, driving);
        }

        void add_constraint_p2p_distance(Point &p1, Point &p2, int distance, int tagId, bool driving) {
            addConstraintP2PDistance(p1, p2, p_param_or_fail(distance), tagId, driving);
        }

        void add_constraint_p2l_distance(Point &p, Line &l, int distance, int tagId, bool driving) {
            addConstraintP2LDistance(p, l, p_param_or_fail(distance), tagId, driving);
        }

        void add_constraint_point_on_line_pl(Point &p, Line &l, int tagId, bool driving) {
            addConstraintPointOnLine(p, l, tagId, driving);
        }

        void add_constraint_parallel(Line &l1, Line &l2, int tagId, bool driving) {
            addConstraintParallel(l1, l2, tagId, driving);
        }

        void add_constraint_perpendicular_ll(Line &l1, Line &l2, int tagId, bool driving) {
            addConstraintPerpendicular(l1, l2, tagId, driving);
        }

        void add_constraint_l2l_angle_pppp(Point &l1p1, Point &l1p2, Point &l2p1, Point &l2p2, int angle, int tagId, bool driving) {
            addConstraintL2LAngle(l1p1, l1p2, l2p1, l2p2, p_param_or_fail(angle), tagId, driving);
        }

        void add_constraint_angle_via_point(Curve &crv1, Curve &crv2, Point &p, int angle, int tagId, bool driving) {
            addConstraintAngleViaPoint(crv1, crv2, p, p_param_or_fail(angle), tagId, driving);
        }

        void add_constraint_p2p_coincident(Point &p1, Point &p2, int tagId, bool driving) {
            addConstraintP2PCoincident(p1, p2, tagId, driving);
        }

        void add_constraint_horizontal_l(Line &l, int tagId, bool driving) {
            addConstraintHorizontal(l, tagId, driving);
        }

        void add_constraint_horizontal_pp(Point &p1, Point &p2, int tagId, bool driving) {
            addConstraintHorizontal(p1, p2, tagId, driving);
        }

        void add_constraint_vertical_l(Line &l, int tagId, bool driving) {
            addConstraintVertical(l, tagId, driving);
        }

        void add_constraint_vertical_pp(Point &p1, Point &p2, int tagId, bool driving) {
            addConstraintVertical(p1, p2, tagId, driving);
        }

        void add_constraint_coordinate_x(Point &p, int x, int tagId, bool driving) {
            addConstraintCoordinateX(p, p_param_or_fail(x), tagId, driving);
        }

        void add_constraint_coordinate_y(Point &p, int y, int tagId, bool driving) {
            addConstraintCoordinateY(p, p_param_or_fail(y), tagId, driving);
        }

        void add_constraint_arc_rules(Arc &a, int tagId, bool driving) {
            addConstraintArcRules(a, tagId, driving);
        }

        void add_constraint_point_on_circle(Point &p, Circle &c, int tagId, bool driving) {
            addConstraintPointOnCircle(p, c, tagId, driving);
        }

        void add_constraint_point_on_bspline(Point &p, BSpline &b, int pointparam, int tagId, bool driving) {
            addConstraintPointOnBSpline(p, b, p_param_or_fail(pointparam), tagId, driving);
        }

        void add_constraint_point_on_arc(Point &p, Arc &a, int tagId, bool driving) {
            addConstraintPointOnArc(p, a, tagId, driving);
        }

        void add_constraint_tangent_lc(Line &l, Circle &c, int tagId, bool driving) {
            addConstraintTangent(l, c, tagId, driving);
        }

        void add_constraint_tangent_la(Line &l, Arc &a, int tagId, bool driving) {
            addConstraintTangent(l, a, tagId, driving);
        }

        void add_constraint_tangent_cc(Circle &c1, Circle &c2, int tagId, bool driving) {
            addConstraintTangent(c1, c2, tagId, driving);
        }

        void add_constraint_tangent_aa(Arc &a1, Arc &a2, int tagId, bool driving) {
            addConstraintTangent(a1, a2, tagId, driving);
        }

        void add_constraint_tangent_ca(Circle &c, Arc &a, int tagId, bool driving) {
            addConstraintTangent(c, a, tagId, driving);
        }

        void add_constraint_circle_radius(Circle &c, int radius, int tagId, bool driving) {
            addConstraintCircleRadius(c, p_param_or_fail(radius), tagId, driving);
        }

        void add_constraint_arc_radius(Arc &a, int radius, int tagId, bool driving) {
            addConstraintArcRadius(a, p_param_or_fail(radius), tagId, driving);
        }

        void add_constraint_circle_diameter(Circle &c, int diameter, int tagId, bool driving) {
            addConstraintCircleDiameter(c, p_param_or_fail(diameter), tagId, driving);
        }

        void add_constraint_arc_diameter(Arc &a, int diameter, int tagId, bool driving) {
            addConstraintArcDiameter(a, p_param_or_fail(diameter), tagId, driving);
        }

        void add_constraint_equal_length(Line &l1, Line &l2, int tagId, bool driving) {
            addConstraintEqualLength(l1, l2, tagId, driving);
        }

        void add_constraint_equal_radius_cc(Circle &c1, Circle &c2, int tagId, bool driving) {
            addConstraintEqualRadius(c1, c2, tagId, driving);
        }

        void add_constraint_equal_radius_ca(Circle &c1, Arc &a2, int tagId, bool driving) {
            addConstraintEqualRadius(c1, a2, tagId, driving);
        }

        void add_constraint_equal_radius_aa(Arc &a1, Arc &a2, int tagId, bool driving) {
            addConstraintEqualRadius(a1, a2, tagId, driving);
        }

        void add_constraint_p2p_symmetric_ppl(Point &p1, Point &p2, Line &l, int tagId, bool driving) {
            addConstraintP2PSymmetric(p1, p2, l, tagId, driving);
        }

        void add_constraint_p2p_symmetric_ppp(Point &p1, Point &p2, Point &p, int tagId, bool driving) {
            addConstraintP2PSymmetric(p1, p2, p, tagId, driving);
        }

    private:
        double* p_param_or_fail(int i) {
            if (p_params.size() <= i) {
                throw std::runtime_error("parameter index outside range");
            }
            return p_params[i];
        }
};

}  // namespace planegcs

#endif  // TINYCAD_PLANEGCS_GCS_SYSTEM_H
